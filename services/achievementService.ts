/**
 * achievementService — 勋章/成就系统核心服务（增强版）
 *
 * 20 个勋章，分为三大类：
 *   基础 (basic)   — 里程碑式，容易达成
 *   进阶 (advanced) — 需要技巧/坚持
 *   趣味 (fun)     — 时间/关键词/行为触发
 *
 * 勋章列表：
 * ┌──────┬──────────────────────────┬────────────────────────────────────┐
 * │ 分类  │ 勋章 ID                   │ 解锁条件                           │
 * ├──────┼──────────────────────────┼────────────────────────────────────┤
 * │ 基础  │ first_word               │ 首次拍照识别单词                    │
 * │ 基础  │ word_collector           │ 累计识别 50 个不同单词              │
 * │ 基础  │ vocab_master_10          │ 掌握 10 个词汇（score>=80）        │
 * │ 基础  │ vocab_master_50          │ 掌握 50 个词汇                     │
 * │ 基础  │ vocab_master_100         │ 掌握 100 个词汇                    │
 * │ 基础  │ vocab_master_500         │ 掌握 500 个词汇                    │
 * │ 基础  │ first_practice           │ 完成首次口语练习                    │
 * │ 基础  │ eloquent_speaker         │ 累计 20 次口语练习                  │
 * ├──────┼──────────────────────────┼────────────────────────────────────┤
 * │ 进阶  │ golden_tongue            │ 连续 3 次口语 > 95 分              │
 * │ 进阶  │ perfect_score            │ 单次口语满分 100                   │
 * │ 进阶  │ repeater                 │ 发音按钮点击 >= 50 次              │
 * │ 进阶  │ persistent_learner       │ 累计学习 7 天                      │
 * │ 进阶  │ study_enthusiast         │ 累计学习 30 天                     │
 * │ 进阶  │ quick_scanner            │ 1 分钟内拍照识别 >= 3 个单词        │
 * ├──────┼──────────────────────────┼────────────────────────────────────┤
 * │ 趣味  │ midnight_learner         │ 23:00-02:00 拍照识别               │
 * │ 趣味  │ light_catcher            │ 11:00-13:00 拍照识别（捕光者）     │
 * │ 趣味  │ afternoon_translator     │ 14:00-17:00 拍照识别（翻译官的午后）│
 * │ 趣味  │ street_reporter          │ 识别到含特定关键词的单词            │
 * │ 趣味  │念念不忘                  │ 同一单词重复点击发音 >= 10 次       │
 * └──────┴──────────────────────────┴────────────────────────────────────┘
 */
import { getAudioPlayCompleteCount } from './soundManager';
import { supabase } from './supabaseClient';

// ─── 常量 ────────────────────────────────────────────
const DEFAULT_USER_ID = 'default_user';

// ─── 类型定义 ─────────────────────────────────────────
export interface BadgeDefinition {
  id: string;                    // 唯一标识
  name: string;                  // 显示名称
  icon: string;                  // Feather 图标名
  description: string;           // 趣味描述（已解锁时显示）
  unlockHint: string;            // 解锁提示（未解锁时显示）
  color: string;                 // 主色调
  category: 'basic' | 'advanced' | 'fun';  // 分类
  progress?: {                   // 量化进度（可选）
    current: number;             // 当前值
    target: number;              // 目标值
  };
}

// ─── 20 个勋章定义 ────────────────────────────────────
export const ALL_BADGES: BadgeDefinition[] = [
  // ===== 基础 (8) =====
  {
    id: 'first_word',
    name: '初识世界',
    icon: 'camera',
    description: '你拍下了第一个单词，世界在你眼中开始变得不同 📸',
    unlockHint: '拍照识别任意一个单词即可解锁',
    color: '#FF6B6B',
    category: 'basic',
  },
  {
    id: 'word_collector',
    name: '万物皆单词',
    icon: 'layers',
    description: '你已经拥有了将现实世界转化为词汇库的能力 🌍',
    unlockHint: '累计拍照识别 50 个不同单词即可解锁',
    color: '#00B894',
    category: 'basic',
  },
  {
    id: 'vocab_master_10',
    name: '词汇学徒',
    icon: 'book',
    description: '你已高分掌握 10 个词汇，发音非常标准 📚',
    unlockHint: '掌握 10 个词汇（口语得分 >= 80 分）',
    color: '#6C5CE7',
    category: 'basic',
  },
  {
    id: 'vocab_master_50',
    name: '词汇能手',
    icon: 'book-open',
    description: '你已高分掌握 50 个词汇，口语能力正在稳步提升 📖',
    unlockHint: '掌握 50 个词汇（口语得分 >= 80 分）',
    color: '#6C5CE7',
    category: 'basic',
  },
  {
    id: 'vocab_master_100',
    name: '百词达人',
    icon: 'bookmark',
    description: '100个高分单词标志着你的英语基础已固若金汤 🎯',
    unlockHint: '掌握 100 个词汇（口语得分 >= 80 分）',
    color: '#6C5CE7',
    category: 'basic',
  },
  {
    id: 'vocab_master_500',
    name: '词汇大师',
    icon: 'award',
    description: '500个标准发音词汇，你已正式跨入英语高手行列 🏆',
    unlockHint: '掌握 500 个词汇（口语得分 >= 80 分）',
    color: '#6C5CE7',
    category: 'basic',
  },
  {
    id: 'first_practice',
    name: '初试啼声',
    icon: 'mic',
    description: '你已成功开启口语实战，大声说出来的感觉真棒 🎤',
    unlockHint: '完成首次口语练习即可解锁',
    color: '#FDCB6E',
    category: 'basic',
  },
  {
    id: 'eloquent_speaker',
    name: '语出惊人',
    icon: 'message-circle',
    description: '20次实战演练，你的口语表达已初见锋芒 🗣️',
    unlockHint: '累计完成 20 次口语练习',
    color: '#E17055',
    category: 'basic',
  },

  // ===== 进阶 (6) =====
  {
    id: 'golden_tongue',
    name: '黄金舌头',
    icon: 'award',
    description: '连续三次 95+ 高分，你的发音简直是教科书级别 🏆',
    unlockHint: '口语练习连续 3 次获得 95 分以上',
    color: '#FDCB6E',
    category: 'advanced',
  },
  {
    id: 'perfect_score',
    name: '完美发音',
    icon: 'star',
    description: '100分的满分表现，你的发音简直无懈可击！⭐',
    unlockHint: '任意一次口语练习获得满分 100 分',
    color: '#FFD93D',
    category: 'advanced',
  },
  {
    id: 'repeater',
    name: '复读机',
    icon: 'repeat',
    description: '你已经耐心地听完了 50 次标准发音，语感大幅提升！🔁',
    unlockHint: '听完标准发音 50 次即可解锁',
    color: '#0984E3',
    category: 'advanced',
  },
  {
    id: 'persistent_learner',
    name: '坚持不懈',
    icon: 'calendar',
    description: '整整 7 天的汗水，你已成功度过了习惯养成的第一周 💪',
    unlockHint: '累计学习 7 天',
    color: '#00CEC9',
    category: 'advanced',
  },
  {
    id: 'study_enthusiast',
    name: '学习达人',
    icon: 'zap',
    description: '整整 30 天的坚持，你已让学习成为了生命中不可或缺的习惯 ⚡',
    unlockHint: '累计学习 30 天',
    color: '#00CEC9',
    category: 'advanced',
  },
  {
    id: 'quick_scanner',
    name: '快手扫描仪',
    icon: 'fast-forward',
    description: '手速惊人，你在 1 分钟内就捕捉到了 3 个新知识点！⚡',
    unlockHint: '在 1 分钟内拍照识别 3 个不同单词',
    color: '#E17055',
    category: 'advanced',
  },

  // ===== 趣味 (6) =====
  {
    id: 'midnight_learner',
    name: '深夜食堂',
    icon: 'moon',
    description: '这么晚还在努力，这份自律终将让你闪闪发光 🌙',
    unlockHint: '需要在凌晨 23:00-02:00 学习哦',
    color: '#6C5CE7',
    category: 'fun',
  },
  {
    id: 'light_catcher',
    name: '捕光者',
    icon: 'sun',
    description: '你在正午阳光下捕捉单词，学习也可以很惬意 ☀️',
    unlockHint: '在中午 11:00-13:00 拍照识别单词',
    color: '#FDCB6E',
    category: 'fun',
  },
  {
    id: 'afternoon_translator',
    name: '翻译官的午后',
    icon: 'coffee',
    description: '慵懒的午后最适合学习，你抓住了这段黄金时光 ☕',
    unlockHint: '在下午 14:00-17:00 拍照识别单词',
    color: '#E17055',
    category: 'fun',
  },
  {
    id: 'street_reporter',
    name: '路边社社长',
    icon: 'map-pin',
    description: '你拍到了生活中的关键词，敏锐的观察力令人佩服 🔍',
    unlockHint: '拍照识别到包含特定关键词的单词（food/coffee/book/music/school 等）',
    color: '#00B894',
    category: 'fun',
  },
  {
    id: 'unforgettable',
    name: '念念不忘',
    icon: 'heart',
    description: '看来这个单词对你很重要，你已经彻底征服它了 💖',
    unlockHint: '同一个单词点击发音按钮 10 次',
    color: '#FF6B6B',
    category: 'fun',
  },
];

// ─── 已解锁勋章缓存 ──────────────────────────────────
let _unlockedCache: Set<string> | null = null;

function invalidateCache(): void {
  _unlockedCache = null;
}

// ─── 数据库操作 ──────────────────────────────────────

/**
 * 查询用户已解锁的所有勋章 ID
 */
export async function getUnlockedBadges(userId: string = DEFAULT_USER_ID): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from('user_achievements')
      .select('badge_id, unlocked_at')
      .eq('user_id', userId);

    if (error) {
      console.warn('⚠️ [achievement] getUnlockedBadges 查询失败:', error.message);
      return [];
    }

    return (data || []).map((row) => row.badge_id);
  } catch (err: any) {
    console.warn('⚠️ [achievement] getUnlockedBadges 异常:', err?.message || err);
    return [];
  }
}

/**
 * 获取已解锁勋章详情（含解锁时间）
 */
export async function getUnlockedBadgeDetails(userId: string = DEFAULT_USER_ID): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const { data, error } = await supabase
      .from('user_achievements')
      .select('badge_id, unlocked_at')
      .eq('user_id', userId);

    if (error) {
      console.warn('⚠️ [achievement] getUnlockedBadgeDetails 查询失败:', error.message);
      return map;
    }

    (data || []).forEach((row) => {
      map.set(row.badge_id, row.unlocked_at);
    });
  } catch (err: any) {
    console.warn('⚠️ [achievement] getUnlockedBadgeDetails 异常:', err?.message || err);
  }
  return map;
}

/**
 * 解锁一个勋章（幂等：已解锁则跳过）
 * @returns 是否为新解锁
 */
export async function unlockBadge(
  badgeId: string,
  userId: string = DEFAULT_USER_ID,
): Promise<boolean> {
  // 检查是否已解锁
  if (_unlockedCache?.has(badgeId)) {
    return false;
  }

  try {
    // 先查重
    const { data: existing } = await supabase
      .from('user_achievements')
      .select('id')
      .eq('user_id', userId)
      .eq('badge_id', badgeId)
      .maybeSingle();

    if (existing) {
      // 已解锁，更新缓存
      if (_unlockedCache) _unlockedCache.add(badgeId);
      return false;
    }

    // 插入新记录
    const { error } = await supabase
      .from('user_achievements')
      .insert({
        user_id: userId,
        badge_id: badgeId,
      });

    if (error) {
      // 唯一约束冲突 = 已存在（并发安全）
      if (error.code === '23505') {
        if (_unlockedCache) _unlockedCache.add(badgeId);
        return false;
      }
      console.warn(`⚠️ [achievement] unlockBadge 失败 (${badgeId}):`, error.message);
      return false;
    }

    // 更新缓存
    if (_unlockedCache) _unlockedCache.add(badgeId);
    console.log(`🏅 [achievement] 新勋章解锁: ${badgeId}`);
    return true;
  } catch (err: any) {
    console.warn(`⚠️ [achievement] unlockBadge 异常 (${badgeId}):`, err?.message || err);
    return false;
  }
}

/**
 * 获取已解锁勋章数量
 */
export async function countUnlockedBadges(userId: string = DEFAULT_USER_ID): Promise<number> {
  try {
    const { count, error } = await supabase
      .from('user_achievements')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (error) {
      console.warn('⚠️ [achievement] countUnlockedBadges 查询失败:', error.message);
      return 0;
    }
    return count ?? 0;
  } catch (err: any) {
    console.warn('⚠️ [achievement] countUnlockedBadges 异常:', err?.message || err);
    return 0;
  }
}

// ─── 勋章检测逻辑 ────────────────────────────────────

/**
 * 检测并解锁「初识世界」
 * 条件：首次拍照识别（由外部在识别成功后调用）
 */
export async function checkFirstWord(userId: string = DEFAULT_USER_ID): Promise<boolean> {
  return unlockBadge('first_word', userId);
}

/**
 * 检测并解锁「万物皆单词」
 * 条件：user_word_scores 中 source='camera' 的单词数 >= 50
 */
export async function checkWordCollector(userId: string = DEFAULT_USER_ID): Promise<boolean> {
  try {
    const { count, error } = await supabase
      .from('user_word_scores')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('source', 'camera');

    if (error) {
      console.warn('⚠️ [achievement] checkWordCollector 查询失败:', error.message);
      return false;
    }

    if ((count ?? 0) >= 50) {
      return unlockBadge('word_collector', userId);
    }
    return false;
  } catch (err: any) {
    console.warn('⚠️ [achievement] checkWordCollector 异常:', err?.message || err);
    return false;
  }
}

/**
 * 获取已掌握的词汇量（best_oral_score >= 80 的唯一单词数）
 * 定义"掌握"：单个单词的历史最高口语得分（best_oral_score）必须 >= 80 分
 */
async function getMasteredVocabCount(userId: string = DEFAULT_USER_ID): Promise<number> {
  try {
    // 统计 user_word_scores 表中 score >= 80 的唯一单词数
    const { count, error } = await supabase
      .from('user_word_scores')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('score', 80);

    if (error) {
      console.warn('⚠️ [achievement] getMasteredVocabCount 查询失败:', error.message);
      return 0;
    }
    return count ?? 0;
  } catch (err: any) {
    console.warn('⚠️ [achievement] getMasteredVocabCount 异常:', err?.message || err);
    return 0;
  }
}

/**
 * 检测词汇量阶梯勋章（10/50/100/500）
 * @returns 新解锁的勋章 ID 列表
 */
export async function checkVocabTiers(userId: string = DEFAULT_USER_ID): Promise<string[]> {
  const newlyUnlocked: string[] = [];
  const count = await getMasteredVocabCount(userId);

  const tiers: Array<{ id: string; threshold: number }> = [
    { id: 'vocab_master_10', threshold: 10 },
    { id: 'vocab_master_50', threshold: 50 },
    { id: 'vocab_master_100', threshold: 100 },
    { id: 'vocab_master_500', threshold: 500 },
  ];

  for (const tier of tiers) {
    if (count >= tier.threshold) {
      const unlocked = await unlockBadge(tier.id, userId);
      if (unlocked) newlyUnlocked.push(tier.id);
    }
  }

  return newlyUnlocked;
}

/**
 * 检测并解锁「初试啼声」
 * 条件：首次完成口语练习（practice_logs 表中有记录）
 */
export async function checkFirstPractice(userId: string = DEFAULT_USER_ID): Promise<boolean> {
  try {
    const { count, error } = await supabase
      .from('practice_logs')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (error) {
      console.warn('⚠️ [achievement] checkFirstPractice 查询失败:', error.message);
      return false;
    }

    if ((count ?? 0) >= 1) {
      return unlockBadge('first_practice', userId);
    }
    return false;
  } catch (err: any) {
    console.warn('⚠️ [achievement] checkFirstPractice 异常:', err?.message || err);
    return false;
  }
}

/**
 * 检测并解锁「语出惊人」
 * 条件：practice_logs 表中的记录数 >= 20
 */
export async function checkEloquentSpeaker(userId: string = DEFAULT_USER_ID): Promise<boolean> {
  try {
    const { count, error } = await supabase
      .from('practice_logs')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (error) {
      console.warn('⚠️ [achievement] checkEloquentSpeaker 查询失败:', error.message);
      return false;
    }

    if ((count ?? 0) >= 20) {
      return unlockBadge('eloquent_speaker', userId);
    }
    return false;
  } catch (err: any) {
    console.warn('⚠️ [achievement] checkEloquentSpeaker 异常:', err?.message || err);
    return false;
  }
}

/**
 * 检测并解锁「黄金舌头」
 * 条件：practice_logs 中最近 3 条记录的 oral_score 都 >= 95
 */
export async function checkGoldenTongue(userId: string = DEFAULT_USER_ID): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('practice_logs')
      .select('oral_score, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(3);

    if (error) {
      console.warn('⚠️ [achievement] checkGoldenTongue 查询失败:', error.message);
      return false;
    }

    if (!data || data.length < 3) return false;

    const allAbove95 = data.every((row) => row.oral_score >= 95);
    if (allAbove95) {
      return unlockBadge('golden_tongue', userId);
    }
    return false;
  } catch (err: any) {
    console.warn('⚠️ [achievement] checkGoldenTongue 异常:', err?.message || err);
    return false;
  }
}

/**
 * 检测并解锁「完美发音」
 * 条件：practice_logs 表中任意一次 oral_score = 100
 */
export async function checkPerfectScore(userId: string = DEFAULT_USER_ID): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('practice_logs')
      .select('id')
      .eq('user_id', userId)
      .eq('oral_score', 100)
      .limit(1);

    if (error) {
      console.warn('⚠️ [achievement] checkPerfectScore 查询失败:', error.message);
      return false;
    }

    if (data && data.length > 0) {
      return unlockBadge('perfect_score', userId);
    }
    return false;
  } catch (err: any) {
    console.warn('⚠️ [achievement] checkPerfectScore 异常:', err?.message || err);
    return false;
  }
}

/**
 * 检测并解锁「复读机」
 * 条件：发音按钮点击次数 >= 50
 */
export async function checkRepeater(
  clickCount: number,
  userId: string = DEFAULT_USER_ID,
): Promise<boolean> {
  if (clickCount >= 50) {
    return unlockBadge('repeater', userId);
  }
  return false;
}

/**
 * 更新学习天数并检测「坚持不懈」和「学习达人」勋章
 * 使用 UTC 日期进行比较，避免时差问题
 * 
 * 逻辑：
 * 1. 获取当前 UTC 日期（YYYY-MM-DD）
 * 2. 对比 profiles.last_learning_date
 * 3. 如果当前日期 > 上次学习日期，原子增加 total_learning_days
 * 4. 更新后检查是否达到 7 天或 30 天
 */
export async function checkStudyDaysAchievements(userId: string = DEFAULT_USER_ID): Promise<string[]> {
  const newlyUnlocked: string[] = [];
  try {
    // 获取当前 UTC 日期（YYYY-MM-DD 格式）
    const now = new Date();
    const currentDate = now.toISOString().split('T')[0]; // 'YYYY-MM-DD'

    // 获取用户当前的学习天数和上次学习日期
    const { data: profileData, error: fetchError } = await supabase
      .from('profiles')
      .select('total_learning_days, last_learning_date')
      .eq('id', userId)
      .maybeSingle();

    if (fetchError) {
      console.warn('⚠️ [achievement] checkStudyDaysAchievements 查询失败:', fetchError.message);
      return newlyUnlocked;
    }

    if (!profileData) {
      console.warn('⚠️ [achievement] 未找到用户 profile');
      return newlyUnlocked;
    }

    let currentDays = profileData.total_learning_days ?? 0;
    const lastDate = profileData.last_learning_date;

    // 检查是否是新的一天（使用 UTC 日期比较）
    const isNewDay = !lastDate || currentDate > lastDate;

    if (isNewDay) {
      // 原子更新：增加学习天数并更新最后学习日期
      const { data: updatedProfile, error: updateError } = await supabase
        .from('profiles')
        .update({
          total_learning_days: (currentDays + 1),
          last_learning_date: currentDate,
        })
        .eq('id', userId)
        .select('total_learning_days')
        .maybeSingle();

      if (updateError) {
        console.warn('⚠️ [achievement] 更新学习天数失败:', updateError.message);
        return newlyUnlocked;
      }

      currentDays = updatedProfile?.total_learning_days ?? (currentDays + 1);
      console.log(`📅 [achievement] 学习天数更新: ${currentDays} 天`);
    }

    // 检查勋章解锁
    if (currentDays >= 7) {
      const u = await unlockBadge('persistent_learner', userId);
      if (u) newlyUnlocked.push('persistent_learner');
    }
    if (currentDays >= 30) {
      const u = await unlockBadge('study_enthusiast', userId);
      if (u) newlyUnlocked.push('study_enthusiast');
    }
  } catch (err: any) {
    console.warn('⚠️ [achievement] checkStudyDaysAchievements 异常:', err?.message || err);
  }
  return newlyUnlocked;
}

/**
 * 检测并解锁「快手扫描仪」
 * 条件：1 分钟内连续识别 3 个不同单词（时间窗口法）
 * 
 * 判定逻辑：
 * 1. 查询 user_words 表中该用户最近保存的、来源为 camera 的记录
 * 2. 获取最近 3 个单词的创建时间戳
 * 3. 判断第1个单词的时间戳 - 第3个单词的时间戳是否 ≤ 60000 毫秒
 * 4. 确保这 3 个单词各不相同
 */
export async function checkQuickScanner(userId: string = DEFAULT_USER_ID): Promise<boolean> {
  try {
    // 查询最近 3 条拍照识别记录，按时间倒序排列
    const { data, error } = await supabase
      .from('user_words')
      .select('word, created_at')
      .eq('user_id', userId)
      .eq('source', 'camera')
      .order('created_at', { ascending: false })
      .limit(3);

    if (error) {
      console.warn('⚠️ [achievement] checkQuickScanner 查询失败:', error.message);
      return false;
    }

    // 至少需要 3 条记录
    if (!data || data.length < 3) {
      return false;
    }

    // 唯一性检查：确保 3 个单词各不相同
    const uniqueWords = new Set(data.map(row => row.word.toLowerCase()));
    if (uniqueWords.size < 3) {
      return false;
    }

    // 时间窗口检查：第1个（最新）和第3个（最早）的时间差 ≤ 60 秒
    const firstTimestamp = new Date(data[0].created_at).getTime();
    const lastTimestamp = new Date(data[2].created_at).getTime();
    const timeDiff = firstTimestamp - lastTimestamp;

    console.log(`⏱️ [achievement] 快手扫描仪检查: 时间差=${timeDiff}ms, 单词=${Array.from(uniqueWords).join(', ')}`);

    if (timeDiff <= 60000) {
      return unlockBadge('quick_scanner', userId);
    }

    return false;
  } catch (err: any) {
    console.warn('⚠️ [achievement] checkQuickScanner 异常:', err?.message || err);
    return false;
  }
}

/**
 * 检测并解锁「深夜食堂」
 * 条件：当前时间在 23:00-02:00 之间
 */
export async function checkMidnightLearner(userId: string = DEFAULT_USER_ID): Promise<boolean> {
  const hour = new Date().getHours();
  const isMidnight = hour >= 23 || hour < 2;
  if (!isMidnight) return false;
  return unlockBadge('midnight_learner', userId);
}

/**
 * 检测并解锁「捕光者」
 * 条件：当前时间在 11:00-13:00 之间
 */
export async function checkLightCatcher(userId: string = DEFAULT_USER_ID): Promise<boolean> {
  const hour = new Date().getHours();
  if (hour >= 11 && hour < 13) {
    return unlockBadge('light_catcher', userId);
  }
  return false;
}

/**
 * 检测并解锁「翻译官的午后」
 * 条件：当前时间在 14:00-17:00 之间
 */
export async function checkAfternoonTranslator(userId: string = DEFAULT_USER_ID): Promise<boolean> {
  const hour = new Date().getHours();
  if (hour >= 14 && hour < 17) {
    return unlockBadge('afternoon_translator', userId);
  }
  return false;
}

/**
 * 特定关键词列表（用于「路边社社长」）
 */
const STREET_REPORTER_KEYWORDS = [
  'food', 'coffee', 'book', 'music', 'school', 'water', 'tree',
  'car', 'dog', 'cat', 'house', 'phone', 'computer', 'table',
  'chair', 'door', 'window', 'street', 'park', 'shop', 'store',
  'restaurant', 'hospital', 'bank', 'hotel', 'airport', 'station',
];

/**
 * 检测并解锁「路边社社长」
 * 条件：识别到的单词包含特定关键词
 */
export async function checkStreetReporter(
  word: string,
  userId: string = DEFAULT_USER_ID,
): Promise<boolean> {
  const lowerWord = word.toLowerCase();
  const matched = STREET_REPORTER_KEYWORDS.some((kw) => lowerWord.includes(kw));
  if (matched) {
    return unlockBadge('street_reporter', userId);
  }
  return false;
}

/**
 * 检测并解锁「念念不忘」
 * 条件：同一单词累计点击发音 >= 10 次
 */
/**
 * 检测并解锁「念念不忘」
 * 条件：同一个单词点击发音（并听完）累计达到 10 次
 * 
 * 特殊逻辑：这是最后一个勋章，解锁后检查是否达成全成就
 */
export async function checkUnforgettable(
  wordClickCounts: Record<string, number>,
  userId: string = DEFAULT_USER_ID,
): Promise<string[]> {
  const newlyUnlocked: string[] = [];
  for (const [_word, count] of Object.entries(wordClickCounts)) {
    if (count >= 10) {
      const u = await unlockBadge('unforgettable', userId);
      if (u) {
        newlyUnlocked.push('unforgettable');
        
        // 检查是否达成全成就
        const allBadgesCount = ALL_BADGES.length;
        const unlockedMap = await getUnlockedBadgeDetails(userId);
        const unlockedCount = Object.keys(unlockedMap).length;
        
        console.log(`🏆 [achievement] 全成就检查: 已解锁 ${unlockedCount}/${allBadgesCount}`);
        
        if (unlockedCount >= allBadgesCount) {
          newlyUnlocked.push('grandmaster'); // 标记全成就达成
          console.log('🎉 [achievement] 恭喜！达成全成就！');
        }
      }
      break; // 只需解锁一次
    }
  }
  return newlyUnlocked;
}

// ─── 一键检测（拍照后调用） ──────────────────────────

/**
 * 拍照识别后调用：检测所有与拍照相关的勋章
 * @param word 当前识别的单词
 * @param recentScanCount 最近 1 分钟内的识别次数
 * @returns 新解锁的勋章 ID 列表
 */
export async function checkCameraAchievements(
  word: string,
  recentScanCount: number = 0,
  userId: string = DEFAULT_USER_ID,
): Promise<string[]> {
  const newlyUnlocked: string[] = [];

  const results = await Promise.all([
    checkFirstWord(userId),
    checkWordCollector(userId),
    checkMidnightLearner(userId),
    checkLightCatcher(userId),
    checkAfternoonTranslator(userId),
    checkStreetReporter(word, userId),
    checkQuickScanner(userId),
  ]);

  if (results[0]) newlyUnlocked.push('first_word');
  if (results[1]) newlyUnlocked.push('word_collector');
  if (results[2]) newlyUnlocked.push('midnight_learner');
  if (results[3]) newlyUnlocked.push('light_catcher');
  if (results[4]) newlyUnlocked.push('afternoon_translator');
  if (results[5]) newlyUnlocked.push('street_reporter');
  if (results[6]) newlyUnlocked.push('quick_scanner');

  // 词汇量阶梯
  const vocabTiers = await checkVocabTiers(userId);
  newlyUnlocked.push(...vocabTiers);

  return newlyUnlocked;
}

/**
 * 口语练习后调用：检测所有与口语相关的勋章
 * @param score 本次口语得分
 * @returns 新解锁的勋章 ID 列表
 */
export async function checkPracticeAchievements(
  score: number,
  userId: string = DEFAULT_USER_ID,
): Promise<string[]> {
  const newlyUnlocked: string[] = [];

  const results = await Promise.all([
    checkFirstPractice(userId),
    checkEloquentSpeaker(userId),
    checkGoldenTongue(userId),
    checkPerfectScore(userId),
  ]);

  if (results[0]) newlyUnlocked.push('first_practice');
  if (results[1]) newlyUnlocked.push('eloquent_speaker');
  if (results[2]) newlyUnlocked.push('golden_tongue');
  if (results[3]) newlyUnlocked.push('perfect_score');

  // 学习天数
  const studyDays = await checkStudyDaysAchievements(userId);
  newlyUnlocked.push(...studyDays);

  // 词汇量阶梯
  const vocabTiers = await checkVocabTiers(userId);
  newlyUnlocked.push(...vocabTiers);

  return newlyUnlocked;
}

/**
 * 发音按钮点击后调用
 * @param clickCount 总点击次数
 * @returns 是否新解锁了「复读机」
 */
export async function checkRepeaterAchievement(
  clickCount: number,
  userId: string = DEFAULT_USER_ID,
): Promise<boolean> {
  return checkRepeater(clickCount, userId);
}

// ─── 工具函数 ────────────────────────────────────────

/**
 * 根据 badgeId 获取勋章定义
 */
export function getBadgeById(badgeId: string): BadgeDefinition | undefined {
  return ALL_BADGES.find((b) => b.id === badgeId);
}

/**
 * 获取所有勋章（含解锁状态 + 进度数据）
 */
export async function getAllBadgesWithStatus(
  userId: string = DEFAULT_USER_ID,
): Promise<Array<BadgeDefinition & { unlocked: boolean; unlockedAt: string | null }>> {
  const unlockedMap = await getUnlockedBadgeDetails(userId);
  const masteredCount = await getMasteredVocabCount(userId);

  return ALL_BADGES.map((badge) => {
    let progress: { current: number; target: number } | undefined;

    // 为量化勋章计算进度
    switch (badge.id) {
      case 'word_collector':
        progress = { current: 0, target: 50 }; // 需要额外查询，这里用占位
        break;
      case 'vocab_master_10':
      case 'vocab_master_50':
      case 'vocab_master_100':
      case 'vocab_master_500': {
        const target = parseInt(badge.id.split('_').pop() || '10', 10);
        progress = { current: Math.min(masteredCount, target), target };
        break;
      }
      case 'eloquent_speaker':
        progress = { current: 0, target: 20 };
        break;
      case 'repeater':
        progress = { current: 0, target: 50 };
        break;
      case 'persistent_learner':
        progress = { current: 0, target: 7 };
        break;
      case 'study_enthusiast':
        progress = { current: 0, target: 30 };
        break;
    }

    return {
      ...badge,
      progress,
      unlocked: unlockedMap.has(badge.id),
      unlockedAt: unlockedMap.get(badge.id) ?? null,
    };
  });
}

/**
 * 获取带实时进度的勋章列表（含额外查询）
 */
export async function getAllBadgesWithRealProgress(
  userId: string = DEFAULT_USER_ID,
): Promise<Array<BadgeDefinition & { unlocked: boolean; unlockedAt: string | null }>> {
  const unlockedMap = await getUnlockedBadgeDetails(userId);
  const masteredCount = await getMasteredVocabCount(userId);

  // 额外查询（带错误保护，防止表或列不存在）
  let cameraCount = 0;
  let practiceCount = 0;
  let studyDays = 0;

  try {
    const cameraCountResult = await supabase
      .from('user_word_scores')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('source', 'camera');
    if (!cameraCountResult.error) cameraCount = cameraCountResult.count ?? 0;
  } catch (_) { /* 忽略 */ }

  try {
    const practiceCountResult = await supabase
      .from('practice_logs')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);
    if (!practiceCountResult.error) practiceCount = practiceCountResult.count ?? 0;
  } catch (_) { /* practice_logs 表可能不存在 */ }

  try {
    const profileResult = await supabase
      .from('profiles')
      .select('total_learning_days')
      .eq('id', userId)
      .maybeSingle();
    if (!profileResult.error && profileResult.data) {
      studyDays = (profileResult.data as any).total_learning_days ?? 0;
    }
  } catch (_) { /* total_learning_days 列可能不存在 */ }

  return ALL_BADGES.map((badge) => {
    let progress: { current: number; target: number } | undefined;

    switch (badge.id) {
      case 'word_collector':
        progress = { current: Math.min(cameraCount, 50), target: 50 };
        break;
      case 'vocab_master_10':
        progress = { current: Math.min(masteredCount, 10), target: 10 };
        break;
      case 'vocab_master_50':
        progress = { current: Math.min(masteredCount, 50), target: 50 };
        break;
      case 'vocab_master_100':
        progress = { current: Math.min(masteredCount, 100), target: 100 };
        break;
      case 'vocab_master_500':
        progress = { current: Math.min(masteredCount, 500), target: 500 };
        break;
      case 'eloquent_speaker':
        progress = { current: Math.min(practiceCount, 20), target: 20 };
        break;
      case 'repeater': {
        const audioCount = getAudioPlayCompleteCount();
        progress = { current: Math.min(audioCount, 50), target: 50 };
        break;
      }
      case 'persistent_learner':
        progress = { current: Math.min(studyDays, 7), target: 7 };
        break;
      case 'study_enthusiast':
        progress = { current: Math.min(studyDays, 30), target: 30 };
        break;
    }

    return {
      ...badge,
      progress,
      unlocked: unlockedMap.has(badge.id),
      unlockedAt: unlockedMap.get(badge.id) ?? null,
    };
  });
}
