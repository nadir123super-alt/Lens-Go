/**
 * practiceService — 口语练习服务（阶梯式：单词 → 例句）
 *
 * 每个单词分两个阶段：
 *   Stage 'word'    → 练习单词本身
 *   Stage 'sentence' → 练习唯一例句
 *
 * 评分策略（鼓励型）：
 *   - 单词：final_score = 60 + (raw_score * 0.4)，只要引擎能识别（raw_score > 0），起步即 60 分
 *   - 例句：基于 ISE 逐词完成率计算，完成率 >= 60% 则 base=60 + 平均分奖励
 *   - 完全无法识别（raw_score === 0）：保持低分，提示重试
 *
 * 数据库同步：
 *   - wordScore  → masteryScore（单词掌握度）
 *   - sentenceScore → sentenceMastery（例句掌握度）
 *
 * 跨页面通信：
 *   - _pendingEvaluationScores: 模块级缓存，供 evaluation-summary 页面读取
 *   - savePendingScores(): practice.tsx 完成时调用，存储成绩数据
 *   - getPendingScores()/clearPendingScores(): evaluation-summary.tsx 读取/清除
 */
import { evaluateWithISE } from './iflytekService';
import { getVocabulary, updateMastery, updateSentenceMastery, VocabEntry } from './vocabularyService';

export interface CardScore {
  id: string;
  word: string;
  wordScore: number;      // 单词阶段得分（鼓励型映射后）
  sentenceScore: number;  // 例句阶段得分（鼓励型映射后）
}

export interface PracticeSession {
  words: VocabEntry[];
  currentIndex: number;
  scores: CardScore[];
  completed: boolean;
}

export type TaskStage = 'word' | 'sentence';

// ====== 跨页面成绩传递缓存 ======
/** 模块级缓存，供 evaluation-summary 页面读取 */
let _pendingEvaluationScores: CardScore[] = [];

/**
 * 保存成绩数据（由 practice.tsx 在完成时调用）
 */
export function savePendingScores(scores: CardScore[]): void {
  _pendingEvaluationScores = [...scores];
}

/**
 * 获取待展示的成绩数据（由 evaluation-summary.tsx 在 mount 时调用）
 */
export function getPendingScores(): CardScore[] {
  return _pendingEvaluationScores;
}

/**
 * 清除待展示的成绩数据
 */
export function clearPendingScores(): void {
  _pendingEvaluationScores = [];
}

// ====== 跨页面预加载 Session 缓存（"再练一组"用） ======
/**
 * 供 evaluation-summary 的"再练一组"按钮使用：
 *   1. 在跳转前先调用 fetchNextPracticeSet() 预取新单词
 *   2. 将结果存入此缓存
 *   3. practice.tsx mount 时消费此缓存，避免重复请求
 */
let _pendingSession: PracticeSession | null = null;

/**
 * 预存下一组练习 session（由 evaluation-summary 调用）
 */
export function setPendingSession(session: PracticeSession): void {
  _pendingSession = session;
}

/**
 * 消费并清空预存的 session（由 practice.tsx initSession 调用）
 * 如果有预存 session，直接返回；否则返回 null（由调用方 fallback 到 fetchNextPracticeSet）
 */
export function consumePendingSession(): PracticeSession | null {
  const s = _pendingSession;
  _pendingSession = null;
  return s;
}

/**
 * 初始化一次练习会话
 * 随机抽取 5-10 个单词，优先低分词
 */
export async function startPractice(): Promise<PracticeSession> {
  const all = await getVocabulary();

  if (all.length === 0) {
    return { words: [], currentIndex: 0, scores: [], completed: true };
  }

  const count = Math.min(Math.max(all.length, 5), 10);
  const shuffled = [...all].sort(() => Math.random() - 0.5);

  const needPractice = shuffled.filter(
    (w) => (w as any).masteryScore !== undefined && (w as any).masteryScore < 80
  );
  const rest = shuffled.filter((w) => !needPractice.includes(w));
  const selected = [...needPractice, ...rest].slice(0, count);

  return {
    words: selected,
    currentIndex: 0,
    scores: [],
    completed: false,
  };
}

/**
 * fetchNextPracticeSet — 智能抽取下一组练习单词
 *
 * 筛选逻辑（优先级逐级下降）：
 *   1. 选取 masteryScore 为 undefined 的单词（从未进行过口语评测）
 *   2. 如果所有单词都已评测过，按 masteryScore 从低到高排序
 *   3. 最多抽取 10 个单词
 *
 * 状态重置：
 *   - 返回的 PracticeSession.currentIndex 固定为 0
 *   - scores 为空数组 []
 *   - 页面应据此重置为第一个单词的'待录音'状态
 *
 * @returns 新的 PracticeSession（currentIndex=0, scores=[]）
 */
export async function fetchNextPracticeSet(): Promise<PracticeSession> {
  const all = await getVocabulary();

  if (all.length === 0) {
    return { words: [], currentIndex: 0, scores: [], completed: true };
  }

  // 步骤 1：分离"从未评测"和"已评测"的单词
  const neverPracticed = all.filter(
    (w) => w.masteryScore === undefined
  );
  const everPracticed = all.filter(
    (w) => w.masteryScore !== undefined
  );

  // 步骤 2：按优先级选取
  if (neverPracticed.length > 0) {
    // 优先选取从未评测的单词（最多 10 个，随机打乱顺序以增加变化性）
    const shuffled = [...neverPracticed].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, 10);

    console.log(
      `[practiceService] fetchNextPracticeSet — 选取 ${selected.length}/${neverPracticed.length} 个未评测单词`,
      selected.map((w) => `${w.word}(masteryScore=undefined)`).join(', ')
    );

    return {
      words: selected,
      currentIndex: 0,
      scores: [],
      completed: false,
    };
  }

  // 步骤 3：所有单词都已评测过 → 按 masteryScore 从低到高排序，取最低的 10 个
  const sortedByLowScore = [...everPracticed].sort(
    (a, b) => (a.masteryScore ?? 100) - (b.masteryScore ?? 100)
  );
  const selected = sortedByLowScore.slice(0, 10);

  console.log(
    `[practiceService] fetchNextPracticeSet — 从 ${everPracticed.length} 个已评测单词中选取分数最低的 ${selected.length} 个`,
    selected.map((w) => `${w.word}(${w.masteryScore})`).join(', ')
  );

  return {
    words: selected,
    currentIndex: 0,
    scores: [],
    completed: false,
  };
}

/**
 * 获取当前练习的单词
 */
export function getCurrentWord(session: PracticeSession): VocabEntry | null {
  if (session.completed || session.currentIndex >= session.words.length) {
    return null;
  }
  return session.words[session.currentIndex];
}

/**
 * 跳过当前单词/例句
 * 不记录得分，直接移到下一个单词
 * 如果是单词阶段但当前单词的例句阶段尚未完成，直接将阶段还原为 word
 * 如果是最后一个单词且跳过，则结束本轮
 * @returns 更新后的 session
 */
export function skipCard(session: PracticeSession): PracticeSession {
  const nextIndex = session.currentIndex + 1;
  const completed = nextIndex >= session.words.length;

  // 如果当前单词还未有任何分数记录，仍用原 scores
  // 如果已有了 wordScore 但还没 sentenceScore，保留已得的 wordScore
  return {
    ...session,
    currentIndex: nextIndex,
    completed,
  };
}

/**
 * 获取当前单词的唯一例句（仅 phrases[0]）
 */
export function getCurrentSentence(session: PracticeSession): string {
  const word = getCurrentWord(session);
  if (word?.phrases && word.phrases.length > 0) {
    return word.phrases[0].e;
  }
  return '';
}

/**
 * 评估语音
 * 真实流程：
 *   1. 静音检测（文件大小 < 2KB）
 *   2. 讯飞 WebSocket API 转写
 *   3. 莱文斯坦编辑距离比对 → 0-100 分
 *
 * @param audioUri 录音文件 URI
 * @param targetText 目标文本（单词或例句）
 * @returns 0-100 得分
 */
/**
 * 鼓励型单词评分映射
 *
 * 核心原则：只要引擎能识别出单词（raw_score > 0），起步即 60 分（及格）。
 * 公式：final_score = 60 + (raw_score * 0.4)
 *
 * - raw_score 范围 0-100，映射后范围 60-100
 * - raw_score = 0（完全无法识别）：返回 0，表示需要重试
 */
export function calculateEncouragingWordScore(rawScore: number): number {
  if (rawScore <= 0) return 0;
  // raw_score 0-100 → final 60-100
  const finalScore = 60 + (rawScore * 0.4);
  return Math.round(Math.min(100, Math.max(0, finalScore)));
}

/**
 * 鼓励型例句评分（基于 ISE 逐词完成率）
 *
 * 从 ISE 返回的 word-level detail 中提取逐词分数，计算：
 *   1. 完成率（completion_rate）= 正确识别的单词数 / 总单词数
 *   2. 平均分（avgAccuracy）= 已识别单词的平均分
 *
 * 评分规则：
 *   - completion_rate >= 60%：base = 60，再加 avgAccuracy * 0.35 奖励分
 *   - completion_rate < 60%：线性比例分 = completion_rate * 100（最高 59 分）
 *   - 完全无逐词数据：回退到 raw_score 直接映射
 *
 * @param rawScore ISE 返回的原始总分
 * @param words ISE 返回的逐词详情数组（可选）
 * @param targetText 目标文本（用于计算总词数）
 */
export function calculateEncouragingSentenceScore(
  rawScore: number,
  words?: Array<{ text: string; score: number }>,
  targetText?: string
): number {
  // 如果有逐词数据，基于完成率计算
  if (words && words.length > 0 && targetText) {
    const targetWords = targetText
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 0);
    const totalWordCount = targetWords.length;

    if (totalWordCount === 0) {
      // 没有目标词，回退到原始分数映射
      return calculateEncouragingWordScore(rawScore);
    }

    // 统计正确识别的单词（score > 0 表示引擎能识别）
    const recognizedWords = words.filter(w => w.score > 0);
    const completionRate = recognizedWords.length / totalWordCount;

    // 计算已识别单词的平均准确度
    const avgAccuracy =
      recognizedWords.length > 0
        ? recognizedWords.reduce((sum, w) => sum + w.score, 0) / recognizedWords.length
        : 0;

    let finalScore: number;

    if (completionRate >= 0.6) {
      // 完成率 >= 60%：起步 60 分 + 平均准确度奖励
      finalScore = 60 + avgAccuracy * 0.35;
    } else {
      // 完成率 < 60%：线性比例分
      finalScore = completionRate * 100;
    }

    console.log(
      `[practiceService] 📊 例句鼓励评分: raw=${rawScore}, ` +
      `totalWords=${totalWordCount}, recognized=${recognizedWords.length}, ` +
      `completionRate=${(completionRate * 100).toFixed(0)}%, ` +
      `avgAccuracy=${avgAccuracy.toFixed(1)}, final=${Math.round(finalScore)}`
    );

    return Math.round(Math.min(100, Math.max(0, finalScore)));
  }

  // 无逐词数据（如 IAT fallback），回退到单词映射
  return calculateEncouragingWordScore(rawScore);
}

/**
 * 语音评测入口（鼓励型评分）
 *
 * 调用 ISE API 获取原始分数和逐词详情，然后根据阶段应用鼓励型映射：
 *   - word 阶段：calculateEncouragingWordScore()
 *   - sentence 阶段：calculateEncouragingSentenceScore()
 *
 * @returns { score: number; detail?: { rawScore: number; words?: Array<{ text: string; score: number }> } }
 */
export async function evaluateSpeech(
  audioUri: string,
  targetText: string,
  stage?: 'word' | 'sentence'
): Promise<{
  score: number;
  detail?: {
    rawScore: number;
    words?: Array<{ text: string; score: number }>;
  };
}> {
  // 使用讯飞 ISE WebSocket API 进行语音评测（发音评分引擎）
  const result = await evaluateWithISE(audioUri, targetText);

  const rawScore = result.score;
  const words = result.detail?.words?.map(w => ({
    text: w.text,
    score: w.score,
  }));

  // 调试日志
  console.log(`[practiceService] [Target]: ${result.target}`);
  console.log(`[practiceService] [Recognized]: ${result.recognized || '(空/无声音)'}`);
  console.log(`[practiceService] [Raw Score]: ${rawScore}`);
  console.log(`[practiceService] [IsSilent]: ${result.isSilent}`);
  if (words) {
    console.log(`[practiceService] [Word Details]: ${JSON.stringify(words)}`);
  }

  // 根据阶段应用鼓励型映射
  let finalScore: number;
  if (stage === 'sentence') {
    finalScore = calculateEncouragingSentenceScore(rawScore, words, targetText);
  } else {
    // 默认按单词评分（也兼容无 stage 参数的情况）
    finalScore = calculateEncouragingWordScore(rawScore);
  }

  console.log(`[practiceService] 🎯 鼓励评分结果: raw=${rawScore}, final=${finalScore}, stage=${stage || 'word'}`);

  return {
    score: finalScore,
    detail: {
      rawScore,
      words,
    },
  };
}

/**
 * 静音检测（不调用 API 的快速预检，基于文件大小）
 * @param audioUri 录音文件 URI
 * @returns { isSilent: boolean; reason?: string }
 */
export async function checkAudioSilence(audioUri: string): Promise<{
  isSilent: boolean;
  reason?: string;
}> {
  try {
    const { getInfoAsync } = await import('expo-file-system/legacy');
    const info = await getInfoAsync(audioUri);
    if (!info.exists) {
      return { isSilent: true, reason: '录音文件不存在' };
    }
    const size = info.size ?? 0;
    // ★ 降低静音判定阈值：从 2048 降到 512 bytes
    // 因为 AMR 编码的文件即使有声音也可能较小
    if (size < 512) {
      return { isSilent: true, reason: '没听到声音，请大声读出来' };
    }
    return { isSilent: false };
  } catch {
    return { isSilent: true, reason: '无法读取录音文件' };
  }
}

/**
 * 强制补全逻辑 — 当 ISE/IAT 返回空结果时，自动重试一次
 *
 * 流程：
 *   1. 第一次识别结果为空 → 检查音频文件是否存在且有效
 *   2. 如果文件有效 → 自动重试第二次识别
 *   3. 如果第二次仍为空 → 返回温和提示
 *
 * @param audioUri 录音文件 URI
 * @param targetText 目标文本
 * @param stage 当前阶段
 * @param maxRetries 最大重试次数（默认 1 次）
 */
export async function evaluateSpeechWithRetry(
  audioUri: string,
  targetText: string,
  stage?: 'word' | 'sentence',
  maxRetries: number = 1
): Promise<{
  score: number;
  detail?: {
    rawScore: number;
    words?: Array<{ text: string; score: number }>;
  };
  retried: boolean;
  isEmpty: boolean;
}> {
  let lastResult: { score: number; detail?: { rawScore: number; words?: Array<{ text: string; score: number }> } } | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    console.log(`[practiceService] 🔄 评测尝试 ${attempt + 1}/${maxRetries + 1} (audioUri=${audioUri})`);

    try {
      const result = await evaluateSpeech(audioUri, targetText, stage);
      lastResult = result;

      // 检查结果是否有效（score > 0 或 有逐词数据）
      const hasValidScore = result.score > 0;
      const hasWords = result.detail?.words && result.detail.words.length > 0;

      if (hasValidScore || hasWords) {
        console.log(`[practiceService] ✅ 第 ${attempt + 1} 次评测成功: score=${result.score}`);
        return {
          ...result,
          retried: attempt > 0,
          isEmpty: false,
        };
      }

      // 结果为空但还有重试次数 → 等待 500ms 后重试
      if (attempt < maxRetries) {
        console.warn(`[practiceService] ⚠️ 第 ${attempt + 1} 次评测结果为空，等待 500ms 后重试...`);
        await new Promise((r) => setTimeout(r, 500));
      }
    } catch (err: any) {
      console.error(`[practiceService] ❌ 第 ${attempt + 1} 次评测异常:`, err.message);

      // 如果是 EMPTY_AUDIO 错误且还有重试次数，等待后重试
      if (err.message === 'EMPTY_AUDIO' && attempt < maxRetries) {
        console.warn(`[practiceService] ⚠️ EMPTY_AUDIO，等待 500ms 后重试...`);
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }

      // 其他错误直接抛出
      throw err;
    }
  }

  // 所有重试都失败
  console.warn(`[practiceService] ⚠️ 所有 ${maxRetries + 1} 次评测均返回空结果`);
  return {
    score: 0,
    detail: lastResult?.detail || { rawScore: 0 },
    retried: true,
    isEmpty: true,
  };
}

/**
 * 记录得分并处理阶段流转
 *
 * @param session 当前会话
 * @param stage 当前阶段 'word' | 'sentence'
 * @param score 得分
 * @returns { updatedSession, action }
 *   action: 'advance_to_sentence' | 'advance_to_next_card' | 'session_complete'
 */
export async function recordStageScore(
  session: PracticeSession,
  stage: TaskStage,
  score: number
): Promise<{
  updatedSession: PracticeSession;
  action: 'advance_to_sentence' | 'advance_to_next_card' | 'session_complete';
}> {
  const current = getCurrentWord(session);
  if (!current) {
    return { updatedSession: session, action: 'session_complete' };
  }

  // 查找或创建 CardScore
  let newScores = [...session.scores];
  let idx = newScores.findIndex((s) => s.id === current.id);

  if (idx === -1) {
    newScores.push({
      id: current.id,
      word: current.word,
      wordScore: 0,
      sentenceScore: 0,
    });
    idx = newScores.length - 1;
  }

  // 记录得分（无论分数多少，均正常通过）
  if (stage === 'word') {
    newScores[idx] = { ...newScores[idx], wordScore: score };

    // 写回数据库（单词掌握度）
    try {
      await updateMastery(current.id, score);
    } catch (err) {
      console.warn('[practiceService] updateMastery 失败:', err);
    }

    const updatedSession = { ...session, scores: newScores };
    return { updatedSession, action: 'advance_to_sentence' };
  }

  // stage === 'sentence'
  newScores[idx] = { ...newScores[idx], sentenceScore: score };

  // 写回数据库（例句掌握度）
  const sentenceText = getCurrentSentence(session);
  try {
    await updateSentenceMastery(current.id, score, sentenceText);
  } catch (err) {
    console.warn('[practiceService] updateSentenceMastery 失败:', err);
  }

  const nextIndex = session.currentIndex + 1;
  const completed = nextIndex >= session.words.length;
  const updatedSession = { ...session, scores: newScores, currentIndex: nextIndex, completed };

  if (completed) {
    return { updatedSession, action: 'session_complete' };
  }
  return { updatedSession, action: 'advance_to_next_card' };
}

/**
 * 生成评测评语（适配鼓励型评分 60-100 范围）
 *
 * 鼓励型评分下分数普遍偏高，调整阈值：
 *   >= 95: Perfect（几乎完美）
 *   >= 85: Excellent（优秀）
 *   >= 75: Good（良好，基本正确）
 *   >= 60: Fair（及格，部分需加强）
 *   < 60:  Keep Trying（需要重试）
 */
export function getScoreFeedback(score: number): {
  level: string;
  feedback: string;
  color: string;
} {
  if (score >= 95) {
    return { level: 'Perfect 🎯', feedback: '发音非常标准！', color: '#34C759' };
  }
  if (score >= 85) {
    return { level: 'Excellent ⭐', feedback: '很不错，继续加油！', color: '#4A90D9' };
  }
  if (score >= 75) {
    return { level: 'Good 👍', feedback: '发音基本正确，注意元音饱满度', color: '#FF9500' };
  }
  if (score >= 60) {
    return { level: 'Fair 🤔', feedback: '部分发音需要加强，多听原声', color: '#FF6B6B' };
  }
  return {
    level: 'Keep Trying 💪',
    feedback: '建议跟读原声反复练习',
    color: '#FF3B30',
  };
}

/**
 * 检查是否全对（鼓励型评分下，所有单词和例句 >= 85 视为完美）
 */
export function isAllPerfect(scores: CardScore[]): boolean {
  if (scores.length === 0) return false;
  return scores.every((s) => s.wordScore >= 85 && s.sentenceScore >= 85);
}

/**
 * 计算总平均分
 */
export function getAverageScore(scores: CardScore[]): number {
  if (scores.length === 0) return 0;
  const all = scores.flatMap((s) => [s.wordScore, s.sentenceScore]);
  return Math.round(all.reduce((a, b) => a + b, 0) / all.length);
}

/**
 * fillSkippedScores — 为 session 中所有单词补全 CardScore 记录
 *
 * 跳过单词默认记录为 { wordScore: 0, sentenceScore: 0 }，确保：
 *   - 成绩统计对象（Result Object）结构完整
 *   - evaluation-summary 页面不会因数据缺失而显示空状态
 *
 * @param session 当前练习会话（可能有跳过的单词缺少分数记录）
 * @returns 补全后的 CardScore 数组
 */
export function fillSkippedScores(session: PracticeSession): CardScore[] {
  const filled: CardScore[] = [];

  for (const word of session.words) {
    const existing = session.scores.find((s) => s.id === word.id);
    if (existing) {
      filled.push(existing);
    } else {
      // 跳过的单词 → 默认 0 分
      filled.push({
        id: word.id,
        word: word.word,
        wordScore: 0,
        sentenceScore: 0,
      });
    }
  }

  return filled;
}
