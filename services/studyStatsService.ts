/**
 * studyStatsService — 学习统计服务（Supabase 版）
 *
 * 提供三个核心功能：
 * 1. 词汇量统计：查询 user_word_scores 表中 score >= 80 的唯一单词总数
 * 2. 学习天数统计：查询 study_logs 表中不重复的学习日期总数
 * 3. 学习日志写入：在拍照识别或口语练习完成后，记录学习日期
 *
 * 数据库表结构（需在 Supabase 中创建）：
 *
 * ── user_word_scores ──
 *   id        UUID (PK, default gen_random_uuid())
 *   user_id   TEXT NOT NULL  — UUID 或 'default_user' 字符串
 *   word      TEXT NOT NULL  — 英文单词（小写）
 *   score     INTEGER NOT NULL  — 口语得分 0-100
 *   source    TEXT NOT NULL  — 'camera' | 'practice'
 *   created_at TIMESTAMPTZ DEFAULT now()
 *   UNIQUE(user_id, word)
 *
 * ── study_logs ──
 *   id         UUID (PK, default gen_random_uuid())
 *   user_id    TEXT NOT NULL  — UUID 或 'default_user' 字符串
 *   study_date DATE NOT NULL  — 仅日期，不含时分秒
 *   source     TEXT NOT NULL  — 'camera' | 'practice'
 *   created_at TIMESTAMPTZ DEFAULT now()
 *   UNIQUE(user_id, study_date)  — 按日期去重，不区分来源
 */
import { supabase } from './supabaseClient';

// ─── 常量 ────────────────────────────────────────────
const DEFAULT_USER_ID = 'default_user';

// ─── 工具函数 ──────────────────────────────────────────
/**
 * 从当前登录会话获取真实 user_id
 * 如果未登录则使用默认 ID，防止写入脏数据
 */
async function getCurrentUserId(): Promise<string> {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    console.warn('⚠️ [studyStats] getCurrentUserId: 用户未登录，使用默认ID');
    return DEFAULT_USER_ID;
  }
  return user.id;
}

// ─── 类型定义 ─────────────────────────────────────────
export interface UserWordScore {
  id?: string;
  user_id: string;
  word: string;
  score: number;
  source: 'camera' | 'practice';
  created_at?: string;
}

export interface StudyLog {
  id?: string;
  user_id: string;
  study_date: string; // YYYY-MM-DD
  source: 'camera' | 'practice';
  created_at?: string;
}

export interface PracticeLog {
  id?: string;
  user_id: string;
  oral_score: number;
  created_at?: string;
}

// ─── 1. 词汇量统计 ────────────────────────────────────

/**
 * 统计已掌握词汇量（score >= 80 的唯一单词数）
 * @param userId 用户 ID，不传则从当前登录会话获取
 * @returns 掌握词汇总数
 */
export async function countMasteredWords(userId?: string): Promise<number> {
  try {
    const uid = userId || await getCurrentUserId();
    console.log(`🔍 [studyStats] countMasteredWords 查询: userId=${uid}`);
    const { count, error } = await supabase
      .from('user_word_scores')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', uid)
      .gte('score', 80);

    if (error) {
      console.warn('⚠️ [studyStats] countMasteredWords 查询失败:', error.message, 'code:', error.code);
      return 0;
    }

    // count 可能为 null（表不存在时），安全处理
    const result = count ?? 0;
    console.log(`📊 [studyStats] 已掌握词汇量: ${result}`);
    return result;
  } catch (err: any) {
    console.warn('⚠️ [studyStats] countMasteredWords 异常:', err?.message || err);
    return 0;
  }
}

/**
 * 获取所有已掌握单词列表（score >= 80）
 * @param userId 用户 ID，不传则从当前登录会话获取
 * @returns 单词列表
 */
export async function getMasteredWords(userId?: string): Promise<string[]> {
  try {
    const uid = userId || await getCurrentUserId();
    const { data, error } = await supabase
      .from('user_word_scores')
      .select('word')
      .eq('user_id', uid)
      .gte('score', 80);

    if (error) {
      console.warn('⚠️ [studyStats] getMasteredWords 查询失败:', error.message);
      return [];
    }

    return (data || []).map((row) => row.word);
  } catch (err: any) {
    console.warn('⚠️ [studyStats] getMasteredWords 异常:', err?.message || err);
    return [];
  }
}

// ─── 2. 学习天数统计 ──────────────────────────────────

/**
 * 统计学习天数（study_logs 中不重复的日期总数）
 * @param userId 用户 ID，不传则从当前登录会话获取
 * @returns 学习天数
 */
export async function countStudyDays(userId?: string): Promise<number> {
  try {
    const uid = userId || await getCurrentUserId();
    console.log(`🔍 [studyStats] countStudyDays 查询: userId=${uid}`);
    const { count, error } = await supabase
      .from('study_logs')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', uid);

    if (error) {
      console.warn('⚠️ [studyStats] countStudyDays 查询失败:', error.message, 'code:', error.code);
      return 0;
    }

    console.log(`📊 [studyStats] 学习天数: ${count}`);
    return count ?? 0;
  } catch (err: any) {
    console.warn('⚠️ [studyStats] countStudyDays 异常:', err?.message || err);
    return 0;
  }
}

// ─── 3. 学习日志写入 ──────────────────────────────────

/**
 * 记录学习日期（写入 study_logs）
 * 自动去重：同一天只记录一次（不区分来源）
 * @param source 来源 'camera' | 'practice'
 * @param userId 用户 ID，不传则从当前登录会话获取
 */
export async function logStudyDate(
  source: 'camera' | 'practice',
  userId?: string,
): Promise<void> {
  const today = new Date();
  const studyDate = today.toISOString().split('T')[0]; // YYYY-MM-DD

  try {
    const uid = userId || await getCurrentUserId();
    console.log(`🔍 [studyStats] logStudyDate 开始: date=${studyDate}, source=${source}, userId=${uid}`);

    // 先检查是否已存在（按日期去重，不区分来源）
    const { data: existing, error: queryError } = await supabase
      .from('study_logs')
      .select('id')
      .eq('user_id', uid)
      .eq('study_date', studyDate)
      .maybeSingle();

    if (queryError) {
      console.warn(`⚠️ [studyStats] logStudyDate 查询失败:`, queryError.message, 'code:', queryError.code);
    }

    if (existing) {
      console.log(`📅 [studyStats] 今日已记录学习日期 (${studyDate})，跳过`);
      return;
    }

    const { error } = await supabase
      .from('study_logs')
      .insert({
        user_id: uid,
        study_date: studyDate,
        source,
      });

    if (error) {
      console.warn('⚠️ [studyStats] logStudyDate 写入失败:', error.message, 'code:', error.code);
    } else {
      console.log(`📅 [studyStats] 已记录学习日期: ${studyDate} (${source})`);
    }
  } catch (err: any) {
    console.warn('⚠️ [studyStats] logStudyDate 异常:', err?.message || err);
  }
}

// ─── 4. 单词分数写入 ──────────────────────────────────

/**
 * 保存单词口语得分（写入 user_word_scores）
 * 保留最高分：如果该单词已有历史分数，仅当新分数更高时才更新
 * @param word 英文单词
 * @param score 口语得分 0-100
 * @param source 来源 'camera' | 'practice'
 * @param userId 用户 ID，不传则从当前登录会话获取
 */
export async function saveWordScore(
  word: string,
  score: number,
  source: 'camera' | 'practice',
  userId?: string,
): Promise<void> {
  if (!word || score == null) return;

  const normalizedWord = word.toLowerCase().trim();

  try {
    const uid = userId || await getCurrentUserId();
    console.log(`🔍 [studyStats] saveWordScore 开始: word=${normalizedWord}, score=${score}, source=${source}, userId=${uid}`);

    // 先查询该单词的现有分数
    const { data: existing, error: queryError } = await supabase
      .from('user_word_scores')
      .select('score')
      .eq('user_id', uid)
      .eq('word', normalizedWord)
      .maybeSingle();

    if (queryError) {
      console.warn(`⚠️ [studyStats] saveWordScore 查询失败 (${normalizedWord}):`, queryError.message, 'code:', queryError.code);
      // 如果表不存在，queryError 会包含 PGRST 错误码
    }

    // 保留最高分：如果已有记录且新分数不高于旧分数，跳过更新
    if (existing && score <= existing.score) {
      console.log(`📊 [studyStats] 保留最高分: ${normalizedWord} = ${existing.score}（新分数 ${score} 未超越）`);
      return;
    }

    // 写入新分数（新记录 或 分数更高时覆盖）
    const { error } = await supabase
      .from('user_word_scores')
      .upsert(
        {
          user_id: uid,
          word: normalizedWord,
          score,
          source,
        },
        {
          onConflict: 'user_id,word',
          ignoreDuplicates: false,
        },
      );

    if (error) {
      console.warn(`⚠️ [studyStats] saveWordScore 失败 (${normalizedWord}, ${score}):`, error.message, 'code:', error.code);
    } else {
      console.log(`📊 [studyStats] 已保存单词分数: ${normalizedWord} = ${score}`);
    }
  } catch (err: any) {
    console.warn('⚠️ [studyStats] saveWordScore 异常:', err?.message || err);
  }
}

/**
 * 一键记录学习活动（同时写入 study_logs + user_word_scores）
 * 适用于拍照识别或口语练习完成后的统一调用
 * @param word 单词
 * @param score 得分
 * @param source 来源
 * @param userId 用户 ID，不传则从当前登录会话获取
 */
export async function recordLearningActivity(
  word: string,
  score: number,
  source: 'camera' | 'practice',
  userId?: string,
): Promise<void> {
  // 并行写入，互不阻塞
  await Promise.all([
    logStudyDate(source, userId),
    saveWordScore(word, score, source, userId),
  ]);
  console.log(`📊 [studyStats] 学习活动已记录: ${word} (${score}分, ${source})`);
}

/**
 * 记录口语练习日志（写入 practice_logs）
 * 用于成就系统检测口语练习相关成就
 * @param oralScore 口语得分（本次练习的综合得分或最高分）
 * @param userId 用户 ID，不传则从当前登录会话获取
 */
export async function logPracticeSession(
  oralScore: number,
  userId?: string,
): Promise<void> {
  try {
    const uid = userId || await getCurrentUserId();
    console.log(`🔍 [studyStats] logPracticeSession 开始: oralScore=${oralScore}, userId=${uid}`);

    const { error } = await supabase
      .from('practice_logs')
      .insert({
        user_id: uid,
        oral_score: oralScore,
      });

    if (error) {
      console.warn('⚠️ [studyStats] logPracticeSession 写入失败:', error.message, 'code:', error.code);
    } else {
      console.log(`📊 [studyStats] 口语练习日志已记录: ${oralScore}分`);
    }
  } catch (err: any) {
    console.warn('⚠️ [studyStats] logPracticeSession 异常:', err?.message || err);
  }
}
