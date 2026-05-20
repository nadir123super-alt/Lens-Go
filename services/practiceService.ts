/**
 * practiceService — 口语练习服务（阶梯式：单词 → 例句）
 *
 * 每个单词分两个阶段：
 *   Stage 'word'    → 练习单词本身
 *   Stage 'sentence' → 练习唯一例句
 *
 * 评分策略（真实反馈型）：
 *   - 单词：基于 Levenshtein Distance 计算字符串相似度，从 0 起算
 *   - 例句：基于单词匹配率计算，准确率 60% 对应 60 分
 *   - 完全无法识别：保持低分，不强制重试
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
  wordScore: number;      // 单词阶段得分（真实反馈型）
  sentenceScore: number;  // 例句阶段得分（真实反馈型）
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
 * Fisher-Yates 洗牌算法（无偏随机）
 */
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
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

// ====== 真实评分算法 ======

/**
 * Levenshtein Distance（编辑距离）算法
 * 计算两个字符串之间的最小编辑操作次数
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  // 初始化矩阵
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  // 填充矩阵
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = a[j - 1] === b[i - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,     // 删除
        matrix[i][j - 1] + 1,     // 插入
        matrix[i - 1][j - 1] + cost // 替换
      );
    }
  }

  return matrix[b.length][a.length];
}

/**
 * 计算字符串相似度（基于 Levenshtein Distance）
 * @returns 0-100 的相似度分数
 */
function calculateStringSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  
  // 预处理：转小写、移除首尾空格、移除标点
  const cleanA = a.toLowerCase().trim().replace(/[^\w\s]/g, '');
  const cleanB = b.toLowerCase().trim().replace(/[^\w\s]/g, '');
  
  if (!cleanA || !cleanB) return 0;
  
  const maxLen = Math.max(cleanA.length, cleanB.length);
  const distance = levenshteinDistance(cleanA, cleanB);
  
  // 计算相似度分数
  const similarity = ((maxLen - distance) / maxLen) * 100;
  
  return Math.round(similarity);
}

/**
 * 真实反馈型单词评分
 * 
 * 基于 Levenshtein Distance 计算识别结果与目标单词的相似度
 * 从 0 分起算，真实反映发音质量
 * 
 * @param transcribedText AI 识别出的文本
 * @param targetText 目标单词
 * @param rawScore ISE 原始分数（作为参考）
 * @returns 0-100 得分
 */
export function calculateRealWordScore(
  transcribedText: string,
  targetText: string,
  rawScore: number
): number {
  if (!transcribedText || !targetText) return 0;
  
  // 使用字符串相似度作为主要评分依据
  const similarity = calculateStringSimilarity(transcribedText, targetText);
  
  // ★ 乱读检测：如果相似度低于 40%，说明用户读的单词与目标单词差异很大
  // 例如目标词是 "toothpaste"，用户读 "Apple" 或随便说了别的词，直接给 0 分
  if (similarity < 40) {
    console.log(
      `[practiceService] 🚫 单词乱读检测: similarity=${similarity}%, ` +
      `transcribed="${transcribedText}", target="${targetText}", 返回 0 分`
    );
    return 0;
  }
  
  // 将 ISE 原始分数与字符串相似度结合
  // ISE 分数反映发音准确度，字符串相似度反映单词识别正确性
  // ★ 大幅提高相似度权重（0.8→0.9），ISE 原始分仅作微调（0.2→0.1）
  let finalScore = Math.round((similarity * 0.9 + rawScore * 0.1));
  
  // ★ 低分段（60-79）保持原有严格度，不做额外调整
  if (finalScore >= 60 && finalScore < 80) {
    const compressed = 60 + Math.pow((finalScore - 60) / 20, 1.3) * 20;
    finalScore = Math.round(compressed);
    console.log(
      `[practiceService] 📊 60-79 分段: original=${Math.round(similarity * 0.9 + rawScore * 0.1)}, ` +
      `compressed=${finalScore}`
    );
  }
  
  // ★ 高分阶段（80-94）逐步提高严格度：使用更高的指数 1.5
  // 分数越高，压缩越明显
  // 80→76, 82→78, 84→80, 86→83, 88→85, 90→88, 92→91, 94→93
  if (finalScore >= 80 && finalScore < 95) {
    const compressed = 80 + Math.pow((finalScore - 80) / 15, 1.5) * 15;
    finalScore = Math.round(compressed);
    console.log(
      `[practiceService] 📊 80-94 高分段严格化: original=${Math.round(similarity * 0.9 + rawScore * 0.1)}, ` +
      `compressed=${finalScore}`
    );
  }
  
  // ★ 95-100 分区间严格化：只有真正像外国人一样的发音才能得到这个区间的分数
  // 使用指数 4.0 曲线，要求 ISE 原始分 >= 85 才有资格进入此区间
  // 95→89.0, 96→89.4, 97→90.4, 98→92.4, 99→96.0, 99.5→98.4, 100→100
  // ISE rawScore 必须 >= 85 才能进入 95-100 区间，否则即使 finalScore 计算值 >= 95 也被压制
  if (finalScore >= 95) {
    // 如果 ISE 原始分低于 85，说明发音质量不够 native，强制降级到 94 以下
    if (rawScore < 85) {
      const cappedScore = Math.min(94, 80 + (rawScore - 60) * 0.35);
      finalScore = Math.round(Math.max(80, cappedScore));
      console.log(
        `[practiceService] 🚫 95-100 区间准入拒绝: rawScore=${rawScore} < 85, ` +
        `降级至 ${finalScore} 分`
      );
    } else {
      // ISE 原始分 >= 85，使用指数 4.0 严格压缩
      let compressed = 95 + Math.pow((finalScore - 95) / 5, 4.0) * 5;
      // 即使 rawScore >= 85，如果 rawScore < 92，最高只能到 98
      if (rawScore < 92 && compressed > 98) {
        compressed = 98;
      }
      // 只有 rawScore >= 95 才能触及 100 分
      if (rawScore < 95 && compressed >= 99.5) {
        compressed = 99;
      }
      finalScore = Math.round(compressed * 10) / 10;
      console.log(
        `[practiceService] 📊 95-100 native 级严格化: original=${Math.round(similarity * 0.9 + rawScore * 0.1)}, ` +
        `rawScore=${rawScore}, compressed=${finalScore}`
      );
    }
  }
  
  return Math.min(100, Math.max(0, finalScore));
}

/**
 * 真实反馈型例句评分
 * 
 * 基于单词匹配率计算得分，准确率 60% 对应 60 分
 * 
 * @param transcribedText AI 识别出的文本
 * @param targetText 目标例句
 * @param rawScore ISE 原始分数（作为参考）
 * @param words ISE 返回的逐词详情（可选）
 * @returns 0-100 得分
 */
export function calculateRealSentenceScore(
  transcribedText: string,
  targetText: string,
  rawScore: number,
  words?: Array<{ text: string; score: number }>
): number {
  if (!transcribedText || !targetText) return 0;
  
  // 提取目标单词列表
  const targetWords = targetText
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 0);
  
  if (targetWords.length === 0) {
    return Math.round(rawScore);
  }
  
  // 使用逐词数据计算匹配率（如果有）
  let matchRate: number;
  let matchedCount = 0;
  
  if (words && words.length > 0) {
    // 使用 ISE 返回的逐词数据
    const recognizedWords = words.filter(w => w.score > 0).map(w => w.text.toLowerCase());
    matchedCount = recognizedWords.filter(rw => targetWords.includes(rw)).length;
    matchRate = matchedCount / targetWords.length;
  } else {
    // 回退到字符串匹配
    const cleanTranscribed = transcribedText.toLowerCase().replace(/[^\w\s]/g, '');
    const transcribedWords = cleanTranscribed.split(/\s+/).filter(w => w.length > 0);
    matchedCount = transcribedWords.filter(tw => targetWords.includes(tw)).length;
    matchRate = matchedCount / targetWords.length;
  }
  
  // ★ 乱读检测：如果整个句子没有一个单词匹配到目标单词，说明用户完全在乱读，直接给 0 分
  if (matchedCount === 0) {
    console.log(
      `[practiceService] 🚫 例句乱读检测: matchedCount=0, ` +
      `transcribed="${transcribedText.substring(0, 50)}", target="${targetText.substring(0, 50)}", 返回 0 分`
    );
    return 0;
  }
  
  // 计算得分：基于匹配率的非线性映射
  // ★ 进一步严格化：提高各分数段门槛
  // 低于 30% 准确率：线性映射，最高 30 分
  // 30%-50% 准确率：提升曲线，从 30 到 50
  // 50%+ 准确率：提升曲线，50 到 100
  let finalScore: number;

  if (matchRate < 0.30) {
    // 低于 30% 准确率：线性映射，最高 30 分
    finalScore = matchRate * 100;
  } else if (matchRate < 0.50) {
    // 30%-50% 准确率：提升曲线，从 30 到 50
    finalScore = 30 + (matchRate - 0.30) * 100;
  } else {
    // 50%+ 准确率：提升曲线，50 到 100
    finalScore = 50 + (matchRate - 0.50) * 100;
  }

  // ★ 结合 ISE 原始分数作为微调，ISE 权重降至最低（0.15→0.1）
  finalScore = Math.round((finalScore * 0.9 + rawScore * 0.1));

  // ★ 低分段（60-79）保持原有严格度，不做额外调整（与单词评分保持一致）
  if (finalScore >= 60 && finalScore < 80) {
    const compressed = 60 + Math.pow((finalScore - 60) / 20, 1.3) * 20;
    finalScore = Math.round(compressed);
    console.log(
      `[practiceService] 📊 例句 60-79 分段: original=${Math.round(finalScore)}, ` +
      `compressed=${finalScore}`
    );
  }

  // ★ 高分阶段（80-94）逐步提高严格度：使用更高的指数 1.5（与单词评分保持一致）
  // 80→76, 82→78, 84→80, 86→83, 88→85, 90→88, 92→91, 94→93
  if (finalScore >= 80 && finalScore < 95) {
    const compressed = 80 + Math.pow((finalScore - 80) / 15, 1.5) * 15;
    finalScore = Math.round(compressed);
    console.log(
      `[practiceService] 📊 例句 80-94 高分段严格化: original=${Math.round(finalScore)}, ` +
      `compressed=${finalScore}`
    );
  }

  // ★ 95-100 分区间严格化：只有真正像外国人一样的发音才能得到这个区间的分数（与单词评分保持一致）
  // 指数 4.0：95→89.0, 96→89.4, 97→90.4, 98→92.4, 99→96.0, 99.5→98.4, 100→100
  // ISE rawScore 必须 >= 85 才能进入 95-100 区间
  if (finalScore >= 95) {
    if (rawScore < 85) {
      const cappedScore = Math.min(94, 80 + (rawScore - 60) * 0.35);
      finalScore = Math.round(Math.max(80, cappedScore));
      console.log(
        `[practiceService] 🚫 例句 95-100 区间准入拒绝: rawScore=${rawScore} < 85, ` +
        `降级至 ${finalScore} 分`
      );
    } else {
      let compressed = 95 + Math.pow((finalScore - 95) / 5, 4.0) * 5;
      if (rawScore < 92 && compressed > 98) {
        compressed = 98;
      }
      if (rawScore < 95 && compressed >= 99.5) {
        compressed = 99;
      }
      finalScore = Math.round(compressed * 10) / 10;
      console.log(
        `[practiceService] 📊 例句 95-100 native 级严格化: original=${Math.round(finalScore)}, ` +
        `rawScore=${rawScore}, compressed=${finalScore}`
      );
    }
  }

  console.log(
    `[practiceService] 📊 例句真实评分: matchRate=${(matchRate * 100).toFixed(0)}%, ` +
    `matchedCount=${matchedCount}/${targetWords.length}, ` +
    `raw=${rawScore}, final=${Math.round(finalScore)}`
  );

  return Math.min(100, Math.max(0, finalScore));
}

/**
 * 语音评测入口（真实反馈型评分）
 *
 * 调用 ISE API 获取识别结果，然后根据阶段应用真实评分：
 *   - word 阶段：calculateRealWordScore()
 *   - sentence 阶段：calculateRealSentenceScore()
 *
 * @returns { score: number; detail?: { rawScore: number; transcribedText: string; words?: Array<{ text: string; score: number }> } }
 */
export async function evaluateSpeech(
  audioUri: string,
  targetText: string,
  stage?: 'word' | 'sentence'
): Promise<{
  score: number;
  detail?: {
    rawScore: number;
    transcribedText: string;
    words?: Array<{ text: string; score: number }>;
  };
}> {
  // 使用讯飞 ISE WebSocket API 进行语音评测（发音评分引擎）
  const result = await evaluateWithISE(audioUri, targetText);

  const rawScore = result.score;
  const transcribedText = result.recognized || '';
  const words = result.detail?.words?.map(w => ({
    text: w.text,
    score: w.score,
  }));

  // 调试日志
  console.log(`[practiceService] [Target]: ${result.target}`);
  console.log(`[practiceService] [Recognized]: ${transcribedText || '(空/无声音)'}`);
  console.log(`[practiceService] [Raw Score]: ${rawScore}`);
  console.log(`[practiceService] [IsSilent]: ${result.isSilent}`);
  if (words) {
    console.log(`[practiceService] [Word Details]: ${JSON.stringify(words)}`);
  }

  // 根据阶段应用真实评分
  let finalScore: number;
  if (stage === 'sentence') {
    finalScore = calculateRealSentenceScore(transcribedText, targetText, rawScore, words);
  } else {
    // 默认按单词评分（也兼容无 stage 参数的情况）
    finalScore = calculateRealWordScore(transcribedText, targetText, rawScore);
  }

  console.log(`[practiceService] 🎯 真实评分结果: raw=${rawScore}, final=${finalScore}, stage=${stage || 'word'}`);

  return {
    score: finalScore,
    detail: {
      rawScore,
      transcribedText,
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
 *   3. 如果第二次仍为空 → 返回 0 分（真实反馈）
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
    transcribedText: string;
    words?: Array<{ text: string; score: number }>;
  };
  retried: boolean;
  isEmpty: boolean;
}> {
  let lastResult: { score: number; detail?: { rawScore: number; transcribedText: string; words?: Array<{ text: string; score: number }> } } | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    console.log(`[practiceService] 🔄 评测尝试 ${attempt + 1}/${maxRetries + 1} (audioUri=${audioUri})`);

    try {
      const result = await evaluateSpeech(audioUri, targetText, stage);
      lastResult = result;

      // 检查结果是否有效（有识别文本或有逐词数据）
      const hasTranscribedText = result.detail?.transcribedText && result.detail.transcribedText.length > 0;
      const hasWords = result.detail?.words && result.detail.words.length > 0;
      const hasValidScore = result.score > 0;

      if (hasTranscribedText || hasWords || hasValidScore) {
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

  // 所有重试都失败，返回 0 分（真实反馈）
  console.warn(`[practiceService] ⚠️ 所有 ${maxRetries + 1} 次评测均返回空结果`);
  return {
    score: 0,
    detail: lastResult?.detail || { rawScore: 0, transcribedText: '' },
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

  // 记录得分（无论分数多少，均正常通过，不强制重试）
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
 * 生成评测评语（中文多级反馈）
 *
 * 5 个等级，覆盖 0-100 分：
 *   >= 90: 🌟 完美 — 发音非常标准
 *   >= 75: 👍 优秀 — 发音很好，继续保持
 *   >= 60: 💪 不错 — 基本正确，注意个别发音
 *   >= 40: 🔄 加油 — 需要多练习，试着放慢语速
 *   < 40:  🎯 再试一次 — 没听清楚，请大声清晰地读出来
 */
export function getScoreFeedback(score: number): {
  level: string;
  feedback: string;
  color: string;
} {
  if (score >= 95) {
    return { level: '完美 🌟', feedback: '发音非常标准，重音轻音和语调都很出色！', color: '#2ECC71' };
  }
  if (score >= 90) {
    return { level: '优秀 👍', feedback: '发音很好，继续保持！', color: '#27AE60' };
  }
  if (score >= 85) {
    return { level: '良好 ✅', feedback: '大部分发音准确，注意个别重音和语调', color: '#3498DB' };
  }
  if (score >= 80) {
    return { level: '不错 📈', feedback: '基本正确，注意发音细节和语调起伏', color: '#5DADE2' };
  }
  if (score >= 65) {
    return { level: '不错 💪', feedback: '基本正确，注意个别发音细节', color: '#F39C12' };
  }
  if (score >= 45) {
    return { level: '加油 🔄', feedback: '发音还需打磨，需要多练习', color: '#E67E22' };
  }
  return {
    level: '继续努力 💪',
    feedback: '发音尚不清晰，继续保持练习',
    color: '#E74C3C',
  };
}

/**
 * 检查是否全对（真实评分下，所有单词和例句 >= 85 视为完美）
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
 */
export async function fetchNextPracticeSet(): Promise<PracticeSession> {
  const all = await getVocabulary();
  console.log('[practiceService] fetchNextPracticeSet -- getVocabulary returned ' + all.length + ' words');

  if (all.length === 0) {
    console.log('[practiceService] fetchNextPracticeSet -- no words, returning empty session');
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
    const shuffled = shuffleArray(neverPracticed);
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
