/**
 * achievementService — 勋章/成就系统核心服务（增强版）
 *
 * 19 个勋章，分为三大类：
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
 * │ 趣味  │ unforgettable            │ 同一单词重复点击发音 >= 10 次       │
 * └──────┴──────────────────────────┴────────────────────────────────────┘
 */
import { getAudioPlayCompleteCount } from '../utils/audioCounter';
import { supabase } from './supabaseClient';

// ─── 常量 ────────────────────────────────────────────
const DEFAULT_USER_ID = 'default_user';

// 获取当前用户ID
async function getCurrentUserId(): Promise<string> {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    console.warn('⚠️ [achievement] getCurrentUserId: 用户未登录，使用默认ID');
    return DEFAULT_USER_ID;
  }
  console.log(`✅ [achievement] getCurrentUserId: 获取用户ID成功 - ${user.id}`);
  return user.id;
}

// ─── 颜色常量 ────────────────────────────────────────
const COLORS = {
  ORANGE: '#F39C12',
  GREEN: '#2ECC71',
  PURPLE: '#9B59B6',
  YELLOW: '#F1C40F',
  CORAL: '#E67E22',
  YELLOW_DARK: '#D68910',
  BLUE: '#3498DB',
  CYAN: '#1ABC9C',
  RED: '#E74C3C',
};

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
    color: COLORS.ORANGE,
    category: 'basic',
  },
  {
    id: 'word_collector',
    name: '万物皆单词',
    icon: 'layers',
    description: '你已经拥有了将现实世界转化为词汇库的能力 🌍',
    unlockHint: '累计拍照识别 50 个不同单词即可解锁',
    color: COLORS.GREEN,
    category: 'basic',
  },
  {
    id: 'vocab_master_10',
    name: '词汇学徒',
    icon: 'book',
    description: '你已高分掌握 10 个词汇，发音非常标准 📚',
    unlockHint: '掌握 10 个词汇（口语得分 >= 80 分）',
    color: COLORS.PURPLE,
    category: 'basic',
  },
  {
    id: 'vocab_master_50',
    name: '词汇能手',
    icon: 'book-open',
    description: '你已高分掌握 50 个词汇，口语能力正在稳步提升 📖',
    unlockHint: '掌握 50 个词汇（口语得分 >= 80 分）',
    color: COLORS.PURPLE,
    category: 'basic',
  },
  {
    id: 'vocab_master_100',
    name: '百词达人',
    icon: 'bookmark',
    description: '100个高分单词标志着你的英语基础已固若金汤 🎯',
    unlockHint: '掌握 100 个词汇（口语得分 >= 80 分）',
    color: COLORS.PURPLE,
    category: 'basic',
  },
  {
    id: 'vocab_master_500',
    name: '词汇大师',
    icon: 'award',
    description: '500个标准发音词汇，你已正式跨入英语高手行列 🏆',
    unlockHint: '掌握 500 个词汇（口语得分 >= 80 分）',
    color: COLORS.PURPLE,
    category: 'basic',
  },
  {
    id: 'first_practice',
    name: '初试啼声',
    icon: 'mic',
    description: '你已成功开启口语实战，大声说出来的感觉真棒 🎤',
    unlockHint: '完成首次口语练习即可解锁',
    color: COLORS.YELLOW,
    category: 'basic',
  },
  {
    id: 'eloquent_speaker',
    name: '语出惊人',
    icon: 'message-circle',
    description: '20次实战演练，你的口语表达已初见锋芒 🗣️',
    unlockHint: '累计完成 20 次口语练习',
    color: COLORS.CORAL,
    category: 'basic',
  },

  // ===== 进阶 (6) =====
  {
    id: 'golden_tongue',
    name: '黄金舌头',
    icon: 'award',
    description: '连续三次 95+ 高分，你的发音简直是教科书级别 🏆',
    unlockHint: '口语练习连续 3 次获得 95 分以上',
    color: COLORS.YELLOW,
    category: 'advanced',
  },
  {
    id: 'perfect_score',
    name: '完美发音',
    icon: 'star',
    description: '100分的满分表现，你的发音简直无懈可击！⭐',
    unlockHint: '任意一次口语练习获得满分 100 分',
    color: COLORS.YELLOW_DARK,
    category: 'advanced',
  },
  {
    id: 'repeater',
    name: '复读机',
    icon: 'repeat',
    description: '你已经耐心地听完了 50 次标准发音，语感大幅提升！🔁',
    unlockHint: '听完标准发音 50 次即可解锁',
    color: COLORS.BLUE,
    category: 'advanced',
  },
  {
    id: 'persistent_learner',
    name: '坚持不懈',
    icon: 'calendar',
    description: '整整 7 天的汗水，你已成功度过了习惯养成的第一周 💪',
    unlockHint: '累计学习 7 天',
    color: COLORS.CYAN,
    category: 'advanced',
  },
  {
    id: 'study_enthusiast',
    name: '学习达人',
    icon: 'zap',
    description: '整整 30 天的坚持，你已让学习成为了生命中不可或缺的习惯 ⚡',
    unlockHint: '累计学习 30 天',
    color: COLORS.CYAN,
    category: 'advanced',
  },
  {
    id: 'quick_scanner',
    name: '快手扫描仪',
    icon: 'fast-forward',
    description: '手速惊人，你在 1 分钟内就捕捉到了 3 个新知识点！⚡',
    unlockHint: '在 1 分钟内拍照识别 3 个不同单词',
    color: COLORS.CORAL,
    category: 'advanced',
  },

  // ===== 趣味 (6) =====
  {
    id: 'midnight_learner',
    name: '深夜食堂',
    icon: 'moon',
    description: '这么晚还在努力，这份自律终将让你闪闪发光 🌙',
    unlockHint: '需要在凌晨 23:00-02:00 学习哦',
    color: COLORS.PURPLE,
    category: 'fun',
  },
  {
    id: 'light_catcher',
    name: '捕光者',
    icon: 'sun',
    description: '你在正午阳光下捕捉单词，学习也可以很惬意 ☀️',
    unlockHint: '在中午 11:00-13:00 拍照识别单词',
    color: COLORS.YELLOW,
    category: 'fun',
  },
  {
    id: 'afternoon_translator',
    name: '翻译官的午后',
    icon: 'coffee',
    description: '慵懒的午后最适合学习，你抓住了这段黄金时光 ☕',
    unlockHint: '在下午 14:00-17:00 拍照识别单词',
    color: COLORS.CORAL,
    category: 'fun',
  },
  {
    id: 'street_reporter',
    name: '路边社社长',
    icon: 'map-pin',
    description: '你拍到了生活中的关键词，敏锐的观察力令人佩服 🔍',
    unlockHint: '拍照识别到包含特定关键词的单词（food/coffee/book/music/school 等）',
    color: COLORS.GREEN,
    category: 'fun',
  },
  {
    id: 'unforgettable',
    name: '念念不忘',
    icon: 'heart',
    description: '看来这个单词对你很重要，你已经彻底征服它了 💖',
    unlockHint: '同一个单词点击发音按钮 10 次',
    color: COLORS.RED,
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
export async function getUnlockedBadges(userId?: string): Promise<string[]> {
  const uid = userId || await getCurrentUserId();
  try {
    console.log(`🔍 [achievement] getUnlockedBadges 查询: userId=${uid}, DEFAULT_USER_ID=${DEFAULT_USER_ID}, 是否使用默认ID=${uid === DEFAULT_USER_ID}`);
    const { data, error } = await supabase
      .from('user_achievements')
      .select('badge_id, unlocked_at')
      .eq('user_id', uid);

    if (error) {
      console.warn('⚠️ [achievement] getUnlockedBadges 查询失败:', error.message, 'code:', error.code);
      return [];
    }

    console.log(`🔍 [achievement] getUnlockedBadges 成功: 找到 ${data?.length || 0} 条记录`);
    return (data || []).map((row) => row.badge_id);
  } catch (err: any) {
    console.warn('⚠️ [achievement] getUnlockedBadges 异常:', err?.message || err);
    return [];
  }
}

/**
 * 获取已解锁勋章详情（含解锁时间）
 */
export async function getUnlockedBadgeDetails(userId?: string): Promise<Map<string, string>> {
  const uid = userId || await getCurrentUserId();
  const map = new Map<string, string>();
  try {
    const { data, error } = await supabase
      .from('user_achievements')
      .select('badge_id, unlocked_at')
      .eq('user_id', uid);

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
  userId?: string,
): Promise<boolean> {
  const uid = userId || await getCurrentUserId();
  console.log(`🔓 [achievement] unlockBadge 尝试解锁: badgeId=${badgeId}, userId=${uid}`);

  try {
    // 先查重
    console.log(`🔍 [achievement] unlockBadge 查询已有记录: user_id=${uid}, badge_id=${badgeId}`);
    const { data: existing } = await supabase
      .from('user_achievements')
      .select('id')
      .eq('user_id', uid)
      .eq('badge_id', badgeId)
      .maybeSingle();

    if (existing) {
      // 已解锁
      console.log(`ℹ️ [achievement] unlockBadge 勋章已存在: ${badgeId}`);
      return false;
    }

    // 插入新记录
    console.log(`📥 [achievement] unlockBadge 插入新记录: user_id=${uid}, badge_id=${badgeId}`);
    const { error } = await supabase
      .from('user_achievements')
      .insert({
        user_id: uid,
        badge_id: badgeId,
      });

    if (error) {
      // 唯一约束冲突 = 已存在（并发安全）
      if (error.code === '23505') {
        console.log(`ℹ️ [achievement] unlockBadge 唯一约束冲突（已存在）: ${badgeId}`);
        return false;
      }
      console.warn(`⚠️ [achievement] unlockBadge 插入失败 (${badgeId}):`, JSON.stringify(error));
      return false;
    }

    console.log(`🏅 [achievement] 新勋章解锁成功: ${badgeId}`);
    return true;
  } catch (err: any) {
    console.warn(`⚠️ [achievement] unlockBadge 异常 (${badgeId}):`, err?.message || err);
    return false;
  }
}

/**
 * 获取已解锁勋章数量
 */
export async function countUnlockedBadges(userId?: string): Promise<number> {
  const uid = userId || await getCurrentUserId();
  try {
    console.log(`🔍 [achievement] countUnlockedBadges 查询: userId=${uid}`);
    const { count, error } = await supabase
      .from('user_achievements')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', uid);

    if (error) {
      console.warn('⚠️ [achievement] countUnlockedBadges 查询失败:', JSON.stringify(error));
      return 0;
    }
    console.log(`🔍 [achievement] countUnlockedBadges 成功: count=${count}`);
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
 * 注意：必须先检查 user_word_scores 中是否有 source='camera' 的记录
 *       否则在 getAllBadgesWithRealProgress 中无条件调用会导致
 *       新用户未拍照就自动解锁此成就
 */
export async function checkFirstWord(userId?: string): Promise<boolean> {
  const uid = userId || await getCurrentUserId();
  console.log(`🎯 [achievement] checkFirstWord 被调用: uid=${uid}`);

  // 先检查用户是否真的有过拍照识别记录
  try {
    const { count, error } = await supabase
      .from('user_word_scores')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', uid)
      .eq('source', 'camera');

    if (error) {
      console.warn('⚠️ [achievement] checkFirstWord 查询拍照记录失败:', error.message);
      return false;
    }

    if (!count || count === 0) {
      console.log(`ℹ️ [achievement] checkFirstWord 用户尚无拍照记录，不解锁`);
      return false;
    }
  } catch (err: any) {
    console.warn('⚠️ [achievement] checkFirstWord 查询异常:', err?.message || err);
    return false;
  }

  return unlockBadge('first_word', uid);
}

/**
 * 检测并解锁「万物皆单词」
 * 条件：user_word_scores 中 source='camera' 的单词数 >= 50
 */
export async function checkWordCollector(userId?: string): Promise<boolean> {
  const uid = userId || await getCurrentUserId();
  try {
    const { count, error } = await supabase
      .from('user_word_scores')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', uid)
      .eq('source', 'camera');

    if (error) {
      console.warn('⚠️ [achievement] checkWordCollector 查询失败:', error.message);
      return false;
    }

    if ((count ?? 0) >= 50) {
      return unlockBadge('word_collector', uid);
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
async function getMasteredVocabCount(userId?: string): Promise<number> {
  const uid = userId || await getCurrentUserId();
  try {
    // 统计 user_word_scores 表中 score >= 80 的唯一单词数
    const { count, error } = await supabase
      .from('user_word_scores')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', uid)
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
export async function checkVocabTiers(userId?: string): Promise<string[]> {
  const uid = userId || await getCurrentUserId();
  const newlyUnlocked: string[] = [];
  const count = await getMasteredVocabCount(uid);

  const tiers: Array<{ id: string; threshold: number }> = [
    { id: 'vocab_master_10', threshold: 10 },
    { id: 'vocab_master_50', threshold: 50 },
    { id: 'vocab_master_100', threshold: 100 },
    { id: 'vocab_master_500', threshold: 500 },
  ];

  for (const tier of tiers) {
    if (count >= tier.threshold) {
      const unlocked = await unlockBadge(tier.id, uid);
      if (unlocked) newlyUnlocked.push(tier.id);
    }
  }

  return newlyUnlocked;
}

/**
 * 检测并解锁「初试啼声」
 * 条件：首次完成口语练习（practice_logs 表中有记录）
 */
export async function checkFirstPractice(userId?: string): Promise<boolean> {
  const uid = userId || await getCurrentUserId();
  console.log(`🎯 [achievement] checkFirstPractice 被调用: uid=${uid}`);
  try {
    const { count, error } = await supabase
      .from('user_word_scores')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', uid)
      .eq('source', 'practice');

    if (error) {
      console.warn('⚠️ [achievement] checkFirstPractice 查询失败:', error.message, 'code:', error.code);
      return false;
    }

    console.log(`📊 [achievement] checkFirstPractice 查询结果: count=${count}`);
    if ((count ?? 0) >= 1) {
      return unlockBadge('first_practice', uid);
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
export async function checkEloquentSpeaker(userId?: string): Promise<boolean> {
  const uid = userId || await getCurrentUserId();
  try {
    const { count, error } = await supabase
      .from('user_word_scores')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', uid)
      .eq('source', 'practice');

    if (error) {
      console.warn('⚠️ [achievement] checkEloquentSpeaker 查询失败:', error.message);
      return false;
    }

    if ((count ?? 0) >= 20) {
      return unlockBadge('eloquent_speaker', uid);
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
export async function checkGoldenTongue(userId?: string): Promise<boolean> {
  const uid = userId || await getCurrentUserId();
  try {
    const { data, error } = await supabase
      .from('user_word_scores')
      .select('score, updated_at')
      .eq('user_id', uid)
      .eq('source', 'practice')
      .order('updated_at', { ascending: false })
      .limit(3);

    if (error) {
      console.warn('⚠️ [achievement] checkGoldenTongue 查询失败:', error.message);
      return false;
    }

    if (!data || data.length < 3) return false;

    const allAbove95 = data.every((row) => row.score >= 95);
    if (allAbove95) {
      return unlockBadge('golden_tongue', uid);
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
export async function checkPerfectScore(userId?: string): Promise<boolean> {
  const uid = userId || await getCurrentUserId();
  try {
    const { data, error } = await supabase
      .from('user_word_scores')
      .select('id')
      .eq('user_id', uid)
      .eq('source', 'practice')
      .gte('score', 100)
      .limit(1);

    if (error) {
      console.warn('⚠️ [achievement] checkPerfectScore 查询失败:', error.message);
      return false;
    }

    if (data && data.length > 0) {
      return unlockBadge('perfect_score', uid);
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
  userId?: string,
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
export async function checkStudyDaysAchievements(userId?: string): Promise<string[]> {
  const uid = userId || await getCurrentUserId();
  const newlyUnlocked: string[] = [];
  try {
    // 从 study_logs 表统计学习天数（与首页 countStudyDays 使用同一数据源）
    // 这样拍照识别和口语练习记录的天数都能被成就系统识别
    const { count, error } = await supabase
      .from('study_logs')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', uid);

    if (error) {
      console.warn('⚠️ [achievement] checkStudyDaysAchievements 查询 study_logs 失败:', error.message);
      return newlyUnlocked;
    }

    const currentDays = count ?? 0;
    console.log(`📅 [achievement] 从 study_logs 统计学习天数: ${currentDays} 天`);

    // 检查勋章解锁
    if (currentDays >= 7) {
      const u = await unlockBadge('persistent_learner', uid);
      if (u) newlyUnlocked.push('persistent_learner');
    }
    if (currentDays >= 30) {
      const u = await unlockBadge('study_enthusiast', uid);
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
export async function checkQuickScanner(userId?: string): Promise<boolean> {
  const uid = userId || await getCurrentUserId();
  try {
    // 查询最近 3 条拍照识别记录，按时间倒序排列
    // 注意：拍照识别的单词保存在 user_notebook 表中（source='camera'），而非 user_words 表
    const { data, error } = await supabase
      .from('user_notebook')
      .select('word, created_at')
      .eq('user_id', uid)
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
      return unlockBadge('quick_scanner', uid);
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
export async function checkMidnightLearner(userId?: string): Promise<boolean> {
  const hour = new Date().getHours();
  const isMidnight = hour >= 23 || hour < 2;
  if (!isMidnight) return false;
  return unlockBadge('midnight_learner', userId);
}

/**
 * 检测并解锁「捕光者」
 * 条件：当前时间在 11:00-13:00 之间
 */
export async function checkLightCatcher(userId?: string): Promise<boolean> {
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
export async function checkAfternoonTranslator(userId?: string): Promise<boolean> {
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
  userId?: string,
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
 * 条件：同一个单词点击发音（并听完）累计达到 10 次
 */
export async function checkUnforgettable(
  wordClickCounts: Record<string, number>,
  userId?: string,
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
  userId?: string,
): Promise<string[]> {
  const uid = userId || await getCurrentUserId();
  const newlyUnlocked: string[] = [];
  console.log(`🎯 [achievement] checkCameraAchievements 被调用: word=${word}, uid=${uid}`);

  const results = await Promise.all([
    checkFirstWord(uid),
    checkWordCollector(uid),
    checkMidnightLearner(uid),
    checkLightCatcher(uid),
    checkAfternoonTranslator(uid),
    checkStreetReporter(word, uid),
    checkQuickScanner(uid),
  ]);

  if (results[0]) newlyUnlocked.push('first_word');
  if (results[1]) newlyUnlocked.push('word_collector');
  if (results[2]) newlyUnlocked.push('midnight_learner');
  if (results[3]) newlyUnlocked.push('light_catcher');
  if (results[4]) newlyUnlocked.push('afternoon_translator');
  if (results[5]) newlyUnlocked.push('street_reporter');
  if (results[6]) newlyUnlocked.push('quick_scanner');

  console.log(`📊 [achievement] checkCameraAchievements 结果: newlyUnlocked=${newlyUnlocked.join(', ')}`);

  // 学习天数勋章（之前遗漏了此调用）
  const studyDays = await checkStudyDaysAchievements(uid);
  newlyUnlocked.push(...studyDays);

  // 词汇量阶梯
  const vocabTiers = await checkVocabTiers(uid);
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
  userId?: string,
): Promise<string[]> {
  const uid = userId || await getCurrentUserId();
  const newlyUnlocked: string[] = [];
  console.log(`🎯 [achievement] checkPracticeAchievements 被调用: score=${score}, uid=${uid}`);

  const results = await Promise.all([
    checkFirstPractice(uid),
    checkEloquentSpeaker(uid),
    checkGoldenTongue(uid),
    checkPerfectScore(uid),
  ]);

  if (results[0]) newlyUnlocked.push('first_practice');
  if (results[1]) newlyUnlocked.push('eloquent_speaker');
  if (results[2]) newlyUnlocked.push('golden_tongue');
  if (results[3]) newlyUnlocked.push('perfect_score');

  console.log(`📊 [achievement] checkPracticeAchievements 结果: newlyUnlocked=${newlyUnlocked.join(', ')}`);

  // 学习天数
  const studyDays = await checkStudyDaysAchievements(uid);
  newlyUnlocked.push(...studyDays);

  // 词汇量阶梯
  const vocabTiers = await checkVocabTiers(uid);
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
  userId?: string,
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
  userId?: string,
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
  userId?: string,
): Promise<Array<BadgeDefinition & { unlocked: boolean; unlockedAt: string | null }>> {
  const uid = userId || await getCurrentUserId();

  // ── 关键修复：进入成就页面时，先触发所有成就检查函数 ──
  // 这样任何已满足条件但尚未写入 user_achievements 表的成就都会被检测到并写入
  console.log(`🏅 [achievement] getAllBadgesWithRealProgress 触发成就检查: uid=${uid}`);
  try {
    await Promise.all([
      checkVocabTiers(uid),
      checkStudyDaysAchievements(uid),
      checkFirstPractice(uid),
      checkEloquentSpeaker(uid),
      checkPerfectScore(uid),
      checkFirstWord(uid),
      checkWordCollector(uid),
    ]);
  } catch (err: any) {
    console.warn('⚠️ [achievement] getAllBadgesWithRealProgress 成就检查异常:', err?.message || err);
  }

  const unlockedMap = await getUnlockedBadgeDetails(uid);
  const masteredCount = await getMasteredVocabCount(uid);

  // 额外查询（带错误保护，防止表或列不存在）
  let cameraCount = 0;
  let practiceCount = 0;
  let studyDays = 0;

  try {
    const cameraCountResult = await supabase
      .from('user_word_scores')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', uid)
      .eq('source', 'camera');
    if (!cameraCountResult.error) cameraCount = cameraCountResult.count ?? 0;
  } catch (_) { /* 忽略 */ }

  try {
    const practiceCountResult = await supabase
      .from('user_word_scores')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', uid)
      .eq('source', 'practice');
    if (!practiceCountResult.error) practiceCount = practiceCountResult.count ?? 0;
  } catch (_) { /* 忽略 */ }

  try {
    const studyDaysResult = await supabase
      .from('study_logs')
      .select('study_date', { count: 'exact', head: true })
      .eq('user_id', uid);
    if (!studyDaysResult.error) {
      studyDays = studyDaysResult.count ?? 0;
    }
  } catch (_) { /* study_logs 表可能不存在 */ }

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
