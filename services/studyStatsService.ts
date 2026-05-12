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
 *   user_id   TEXT NOT NULL  — 用户标识（当前用设备 ID 或固定值）
 *   word      TEXT NOT NULL  — 英文单词（小写）
 *   score     INTEGER NOT NULL  — 口语得分 0-100
 *   source    TEXT NOT NULL  — 'camera' | 'practice'
 *   created_at TIMESTAMPTZ DEFAULT now()
 *   UNIQUE(user_id, word)
 *
 * ── study_logs ──
 *   id         UUID (PK, default gen_random_uuid())
 *   user_id    TEXT NOT NULL
 *   study_date DATE NOT NULL  — 仅日期，不含时分秒
 *   source     TEXT NOT NULL  — 'camera' | 'practice'
 *   created_at TIMESTAMPTZ DEFAULT now()
 *   UNIQUE(user_id, study_date, source)
 */
import { supabase } from './supabaseClient';

// ─── 常量 ────────────────────────────────────────────
// 当前使用固定 user_id，后续可对接用户系统
const DEFAULT_USER_ID = 'default_user';

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

// ─── 1. 词汇量统计 ────────────────────────────────────

/**
 * 统计已掌握词汇量（score >= 80 的唯一单词数）
 * @param userId 用户 ID，默认 'default_user'
 * @returns 掌握词汇总数
 */
export async function countMasteredWords(userId: string = DEFAULT_USER_ID): Promise<number> {
  try {
    const { count, error } = await supabase
      .from('user_word_scores')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('score', 80);

    if (error) {
      console.warn('⚠️ [studyStats] countMasteredWords 查询失败:', error.message);
      return 0;
    }

    console.log(`📊 [studyStats] 已掌握词汇量: ${count}`);
    return count ?? 0;
  } catch (err: any) {
    console.warn('⚠️ [studyStats] countMasteredWords 异常:', err?.message || err);
    return 0;
  }
}

/**
 * 获取所有已掌握单词列表（score >= 80）
 * @param userId 用户 ID
 * @returns 单词列表
 */
export async function getMasteredWords(userId: string = DEFAULT_USER_ID): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from('user_word_scores')
      .select('word')
      .eq('user_id', userId)
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
 * @param userId 用户 ID，默认 'default_user'
 * @returns 学习天数
 */
export async function countStudyDays(userId: string = DEFAULT_USER_ID): Promise<number> {
  try {
    const { count, error } = await supabase
      .from('study_logs')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (error) {
      console.warn('⚠️ [studyStats] countStudyDays 查询失败:', error.message);
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
 * 自动去重：同一天同一来源只记录一次
 * @param source 来源 'camera' | 'practice'
 * @param userId 用户 ID
 */
export async function logStudyDate(
  source: 'camera' | 'practice',
  userId: string = DEFAULT_USER_ID,
): Promise<void> {
  const today = new Date();
  const studyDate = today.toISOString().split('T')[0]; // YYYY-MM-DD

  try {
    // 先检查是否已存在（去重）
    const { data: existing } = await supabase
      .from('study_logs')
      .select('id')
      .eq('user_id', userId)
      .eq('study_date', studyDate)
      .eq('source', source)
      .maybeSingle();

    if (existing) {
      console.log(`📅 [studyStats] 今日已记录学习日期 (${studyDate}, ${source})，跳过`);
      return;
    }

    const { error } = await supabase
      .from('study_logs')
      .insert({
        user_id: userId,
        study_date: studyDate,
        source,
      });

    if (error) {
      console.warn('⚠️ [studyStats] logStudyDate 写入失败:', error.message);
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
 * 使用 upsert：同一用户同一单词会覆盖更新
 * @param word 英文单词
 * @param score 口语得分 0-100
 * @param source 来源 'camera' | 'practice'
 * @param userId 用户 ID
 */
export async function saveWordScore(
  word: string,
  score: number,
  source: 'camera' | 'practice',
  userId: string = DEFAULT_USER_ID,
): Promise<void> {
  if (!word || score == null) return;

  const normalizedWord = word.toLowerCase().trim();

  try {
    const { error } = await supabase
      .from('user_word_scores')
      .upsert(
        {
          user_id: userId,
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
      console.warn(`⚠️ [studyStats] saveWordScore 失败 (${normalizedWord}, ${score}):`, error.message);
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
 * @param userId 用户 ID
 */
export async function recordLearningActivity(
  word: string,
  score: number,
  source: 'camera' | 'practice',
  userId: string = DEFAULT_USER_ID,
): Promise<void> {
  // 并行写入，互不阻塞
  await Promise.all([
    logStudyDate(source, userId),
    saveWordScore(word, score, source, userId),
  ]);
  console.log(`📊 [studyStats] 学习活动已记录: ${word} (${score}分, ${source})`);
}
