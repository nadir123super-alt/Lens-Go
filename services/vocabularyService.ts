/**
 * 生词本服务 - Supabase 云端存储单词及例句
 *
 * 2025-05-12 重构：从本地 expo-file-system 迁移至 Supabase user_notebook 表
 * - 所有读写操作通过 supabase.from('user_notebook') 完成
 * - 所有查询自动带上 .eq('user_id', userId)
 * - userId 从当前登录 session 获取
 *
 * 双共享词库架构（2025-05-14 新增）：
 *   - search_word_bank：单词查询模块专用，存储标准词典例句
 *   - shared_word_bank：拍照识别模块专用，存储场景化例句
 *   - 两库完全隔离，未命中时调用 AI 生成并异步缓存
 *
 * 数据完整性校验：
 *   在写入前，严格校验 word、translation、phrases（≥2 条，每条有 e 和 c）
 *   校验不通过则抛出错误，防止脏数据写入
 */
import { fetchPhrasesForObject } from './aiService';
import { supabase } from './supabaseClient';

// AI API Key（与 camera.tsx 保持一致）
const API_KEY = 'f70c822d62bb4fa488e6cf93401a1ed6.MM9sPamtfzmwXDHv';

// ─── 共享词库操作函数 ─────────────────────────────────────────

/**
 * 查询 search_word_bank（单词查询模块专用）
 * 双轨制词库隔离逻辑：shared=拍照, search=查询
 * @param word 英文单词
 * @returns 包含 translation 和例句的对象，未命中返回 null
 */
async function querySearchWordBank(word: string): Promise<{ translation: string; phrases: Array<{ e: string; c: string }> } | null> {
  try {
    const { data, error } = await supabase
      .from('search_word_bank')
      .select('translation, example_en_1, example_cn_1, example_en_2, example_cn_2')
      .eq('word', word.toLowerCase().trim())
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    // 解析两条例句
    const phrases: Array<{ e: string; c: string }> = [];
    if (data.example_en_1 && data.example_cn_1) {
      phrases.push({ e: data.example_en_1, c: data.example_cn_1 });
    }
    if (data.example_en_2 && data.example_cn_2) {
      phrases.push({ e: data.example_en_2, c: data.example_cn_2 });
    }

    // 必须有完整的两条例句才返回
    if (phrases.length < 2) {
      return null;
    }

    return {
      translation: data.translation || '',
      phrases,
    };
  } catch {
    return null;
  }
}

/**
 * 异步写入 search_word_bank（单词查询模块专用）
 * 双轨制词库隔离逻辑：shared=拍照, search=查询
 * @param word 英文单词
 * @param translation 中文翻译
 * @param phrases 例句数组（至少 2 条）
 */
async function asyncWriteSearchWordBank(word: string, translation: string, phrases: Array<{ e: string; c: string }>): Promise<void> {
  try {
    // 全有或全无校验：只有当 4 个字段全部非空时才写入
    if (phrases.length < 2) {
      console.warn(`⚠️ [vocabularyService] search_word_bank 写入跳过：例句不足 2 条: ${word}`);
      return;
    }

    const phrase1 = phrases[0];
    const phrase2 = phrases[1];

    // 数据洁癖：任何一个字段缺失，严禁录入共享库
    if (!phrase1.e || !phrase1.c || !phrase2.e || !phrase2.c) {
      console.warn(`⚠️ [vocabularyService] search_word_bank 写入跳过：字段不完整: ${word}`);
      return;
    }

    await supabase
      .from('search_word_bank')
      .insert({
        word: word.toLowerCase().trim(),
        translation,
        example_en_1: phrase1.e,
        example_cn_1: phrase1.c,
        example_en_2: phrase2.e,
        example_cn_2: phrase2.c,
      })
      .select();
    console.log(`📥 [vocabularyService] 异步写入 search_word_bank: ${word}`);
  } catch (error) {
    console.warn(`⚠️ [vocabularyService] 写入 search_word_bank 失败: ${word}`, error);
    // 忽略错误，不影响用户体验
  }
}

/**
 * 查询 shared_word_bank（拍照识别模块专用）
 * 
 * 注意：此表仅作为拍照识别模块的共享词库使用
 * 双轨制词库隔离逻辑：shared=拍照, search=查询
 * 
 * @param word 英文单词
 * @returns 包含 translation 和例句的对象，未命中返回 null
 */
async function querySharedWordBank(word: string): Promise<{ translation: string; phrases: Array<{ e: string; c: string }> } | null> {
  try {
    const { data, error } = await supabase
      .from('shared_word_bank')
      .select('translation, example_en_1, example_cn_1, example_en_2, example_cn_2')
      .eq('word', word.toLowerCase().trim())
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    // 解析两条例句
    const phrases: Array<{ e: string; c: string }> = [];
    if (data.example_en_1 && data.example_cn_1) {
      phrases.push({ e: data.example_en_1, c: data.example_cn_1 });
    }
    if (data.example_en_2 && data.example_cn_2) {
      phrases.push({ e: data.example_en_2, c: data.example_cn_2 });
    }

    // 必须有完整的两条例句才返回
    if (phrases.length < 2) {
      return null;
    }

    return {
      translation: data.translation || '',
      phrases,
    };
  } catch {
    return null;
  }
}

/**
 * 异步写入 shared_word_bank（拍照识别模块专用）
 * 
 * 注意：此表仅作为拍照识别模块的共享词库使用
 * 双轨制词库隔离逻辑：shared=拍照, search=查询
 * 
 * @param word 英文单词
 * @param translation 中文翻译
 * @param phrases 例句数组（至少 2 条）
 */
async function asyncWriteSharedWordBank(word: string, translation: string, phrases: Array<{ e: string; c: string }>): Promise<void> {
  try {
    // 全有或全无校验：只有当 4 个字段全部非空时才写入
    if (phrases.length < 2) {
      console.warn(`⚠️ [vocabularyService] shared_word_bank 写入跳过：例句不足 2 条: ${word}`);
      return;
    }

    const phrase1 = phrases[0];
    const phrase2 = phrases[1];

    // 数据洁癖：任何一个字段缺失，严禁录入共享库
    if (!phrase1.e || !phrase1.c || !phrase2.e || !phrase2.c) {
      console.warn(`⚠️ [vocabularyService] shared_word_bank 写入跳过：字段不完整: ${word}`);
      return;
    }

    await supabase
      .from('shared_word_bank')
      .insert({
        word: word.toLowerCase().trim(),
        translation,
        example_en_1: phrase1.e,
        example_cn_1: phrase1.c,
        example_en_2: phrase2.e,
        example_cn_2: phrase2.c,
      })
      .select();
    console.log(`📥 [vocabularyService] 异步写入 shared_word_bank: ${word}`);
  } catch (error) {
    console.warn(`⚠️ [vocabularyService] 写入 shared_word_bank 失败: ${word}`, error);
    // 忽略错误，不影响用户体验
  }
}

// ─── 类型定义 ─────────────────────────────────────────

export interface VocabEntry {
  id: string;
  word: string;
  translation: string;
  usage?: string;
  phrases: Array<{ e: string; c: string }>;
  imagePath?: string;
  source: 'camera' | 'search';
  timestamp: number;
  masteryScore?: number;       // 0-100 单词口语掌握度
  sentenceMastery?: number;    // 0-100 例句口语掌握度
  sentencePracticed?: string;  // 最近练习的例句文本（用于校验）
}

/** Supabase 行原始格式 */
interface NotebookRow {
  id: string;
  user_id: string;
  word: string;
  translation: string;
  usage: string;
  phrases: any;
  image_path: string;
  source: string;
  mastery_score: number | null;
  sentence_mastery: number | null;
  sentence_practiced: string;
  created_at: string;
  updated_at: string;
}

// ─── 工具函数 ─────────────────────────────────────────

/**
 * 获取当前登录用户的 ID
 * 如果未登录则抛出错误
 */
async function getCurrentUserId(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('用户未登录，请先登录');
  }
  return user.id;
}

/**
 * 将 Supabase 行数据转换为 VocabEntry
 */
function rowToVocabEntry(row: NotebookRow): VocabEntry {
  let phrases: Array<{ e: string; c: string }> = [];
  if (row.phrases) {
    if (typeof row.phrases === 'string') {
      try { phrases = JSON.parse(row.phrases); } catch { phrases = []; }
    } else if (Array.isArray(row.phrases)) {
      phrases = row.phrases;
    }
  }

  return {
    id: row.id,
    word: row.word,
    translation: row.translation || '',
    usage: row.usage || '',
    phrases,
    imagePath: row.image_path || '',
    source: (row.source === 'camera' ? 'camera' : 'search') as 'camera' | 'search',
    timestamp: new Date(row.created_at).getTime(),
    masteryScore: row.mastery_score ?? undefined,
    sentenceMastery: row.sentence_mastery ?? undefined,
    sentencePracticed: row.sentence_practiced || '',
  };
}

// ─── 数据完整性校验 ────────────────────────────────────

/**
 * 数据完整性校验函数
 * 检查单词数据是否包含所有必要字段：
 * - word（非空字符串）
 * - translation（非空字符串）
 * - phrases（数组，至少 2 条）
 * - 每条 phrase 必须有 e（英文）和 c（中文），且均非空
 *
 * @param data - 待校验的单词数据
 * @returns 校验结果 { valid, missingFields }
 */
export function isDataComplete(data: {
  word: string;
  translation: string;
  phrases: Array<{ e: string; c: string }>;
}): { valid: boolean; missingFields: string[] } {
  const missing: string[] = [];

  if (!data.word || typeof data.word !== 'string' || data.word.trim().length === 0) {
    missing.push('word');
  }
  if (!data.translation || typeof data.translation !== 'string' || data.translation.trim().length === 0) {
    missing.push('translation');
  }
  if (!Array.isArray(data.phrases) || data.phrases.length < 2) {
    missing.push('phrases（至少2条）');
  } else {
    data.phrases.forEach((p, index) => {
      if (!p.e || typeof p.e !== 'string' || p.e.trim().length === 0) {
        missing.push(`phrases[${index}].e`);
      }
      if (!p.c || typeof p.c !== 'string' || p.c.trim().length === 0) {
        missing.push(`phrases[${index}].c`);
      }
    });
  }

  return { valid: missing.length === 0, missingFields: missing };
}

// ─── 核心 CRUD ────────────────────────────────────────

/**
 * 从 Supabase 加载当前用户的所有生词
 */
async function loadAll(): Promise<VocabEntry[]> {
  try {
    const userId = await getCurrentUserId();
    const { data, error } = await supabase
      .from('user_notebook')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('[vocabularyService] loadAll 查询失败:', error.message);
      return [];
    }

    return (data || []).map((row: any) => rowToVocabEntry(row as NotebookRow));
  } catch (err: any) {
    console.warn('[vocabularyService] loadAll 异常:', err?.message || err);
    return [];
  }
}

/**
 * 确保单词有例句：优先查询共享词库，未命中时调用 AI 生成
 * 双轨制词库隔离逻辑：shared=拍照, search=查询
 * 
 * @param word 英文单词
 * @param phrases 已有例句
 * @param source 来源（'search' 或 'camera'）
 * @param translation 中文翻译（用于写入共享词库）
 * @returns 例句数组（至少 2 条）
 */
async function ensurePhrases(
  word: string,
  phrases: Array<{ e: string; c: string }>,
  source: 'search' | 'camera' = 'search',
  translation?: string
): Promise<Array<{ e: string; c: string }>> {
  // 如果已有足够例句，直接返回
  if (phrases && phrases.length >= 2) {
    return phrases;
  }

  // 步骤 1：优先查询对应来源的共享词库（性能优化：查询共享库在调用 AI 之前）
  let bankResult = null;
  if (source === 'search') {
    // 查询场景：只查 search_word_bank，不查拍照库
    bankResult = await querySearchWordBank(word);
  } else {
    // 拍照识别场景：只查 shared_word_bank，不查查询库
    bankResult = await querySharedWordBank(word);
  }

  // 步骤 2：词库命中处理（已保证有完整两条例句）
  if (bankResult && bankResult.phrases) {
    console.log(`📤 [vocabularyService] 从 ${source === 'search' ? 'search_word_bank' : 'shared_word_bank'} 获取例句: ${word}`);
    return bankResult.phrases;
  }

  // 步骤 3：词库未命中，调用 AI 生成（带重试机制）
  // AI 会自动重试最多 3 次，失败则抛出错误，不使用兜底模板
  const generatedPhrases = await fetchPhrasesForObject(word, API_KEY, false, source);
  console.log(`📝 [vocabularyService] 为 "${word}" 通过 AI 生成 ${generatedPhrases.length} 个例句`);

  // 确保至少有两条例句
  const finalPhrases = generatedPhrases.slice(0, 2);
  if (finalPhrases.length < 2) {
    throw new Error(`AI 返回例句不足（仅返回 ${finalPhrases.length} 条，需要至少 2 条）`);
  }

  // 步骤 4：异步写入共享词库（不阻塞主流程）
  // 注意：写入共享库的操作会在内部进行"全有或全无"校验
  // AI 生成成功后已经自动存入对应词库，这里不再重复写入
  // 但为了保持兼容，保留本地词库写入逻辑
  if (translation && generatedPhrases.length >= 2) {
    if (source === 'search') {
      asyncWriteSearchWordBank(word, translation, generatedPhrases);
    } else {
      asyncWriteSharedWordBank(word, translation, generatedPhrases);
    }
  }

  return finalPhrases;
}

/**
 * 手动收藏（查词场景使用）
 * 查重逻辑：区分来源（search/camera），同一来源的同名词不重复收藏
 * 如果未提供例句，自动生成本地例句
 */
export async function addVocabulary(
  word: string,
  translation: string,
  phrases: Array<{ e: string; c: string }>,
  source: 'camera' | 'search' = 'search',
  usage?: string,
  imagePath?: string,
): Promise<'saved' | 'already_exists'> {
  const userId = await getCurrentUserId();
  const normalizedWord = word.toLowerCase().trim();

  // 检查同一来源是否已收藏（区分来源查重）
  const { data: existing } = await supabase
    .from('user_notebook')
    .select('id')
    .eq('user_id', userId)
    .eq('word', normalizedWord)
    .eq('source', source)
    .maybeSingle();

  if (existing) {
    // 同一来源已收藏 → 提示用户
    console.log(`📝 [addVocabulary] ${source === 'search' ? '查询' : '拍照'}途径已收藏过: ${word}`);
    return 'already_exists';
  }

  // 确保有例句（优先查询共享词库，未命中时调用 AI 生成）
  const finalPhrases = await ensurePhrases(word, phrases, source, translation);

  // 数据完整性校验：写入前严格检查
  const check = isDataComplete({ word, translation, phrases: finalPhrases });
  if (!check.valid) {
    console.error(`❌ [addVocabulary] 数据完整性校验失败: ${word}`, check.missingFields);
    throw new Error(
      `数据生成不完整，请尝试重新识别。缺失字段: ${check.missingFields.join(', ')}`
    );
  }

  // 插入新记录
  const { error } = await supabase
    .from('user_notebook')
    .insert({
      user_id: userId,
      word: normalizedWord,
      translation,
      usage: usage || '',
      phrases: JSON.stringify(finalPhrases),
      image_path: imagePath || '',
      source,
    });

  if (error) {
    console.error(`❌ [addVocabulary] 写入失败: ${word}`, error.message);
    throw new Error(`保存失败: ${error.message}`);
  }

  console.log(`📝 [addVocabulary] 已保存: ${word} (source: ${source})`);
  return 'saved';
}

/**
 * 自动收藏（拍照识别场景使用）
 * 查重逻辑：区分来源（search/camera），同一来源的同名词不重复收藏
 * 如果未提供例句，自动生成本地例句
 * 返回 'saved'（新词已保存）或 'skipped'（同一来源已有该词，已跳过）
 */
export async function autoAddVocabulary(
  word: string,
  translation: string,
  phrases: Array<{ e: string; c: string }>,
  source: 'camera' | 'search' = 'camera',
  usage?: string,
  imagePath?: string,
  ensureCompleteExamples?: boolean,
): Promise<'saved' | 'skipped'> {
  const userId = await getCurrentUserId();
  const normalizedWord = word.toLowerCase().trim();

  // 检查同一来源是否已收藏（区分来源查重）
  const { data: existing } = await supabase
    .from('user_notebook')
    .select('id')
    .eq('user_id', userId)
    .eq('word', normalizedWord)
    .eq('source', source)
    .maybeSingle();

  if (existing) {
    // 同一来源已收藏 → 跳过，保留原有数据
    console.log(`📝 [autoAddVocabulary] ${source === 'search' ? '查询' : '拍照'}途径已收藏过，跳过: ${word}`);
    return 'skipped';
  }

  // 确保有例句（优先查询共享词库，未命中时调用 AI 生成）
  const finalPhrases = await ensurePhrases(word, phrases, source, translation);

  // 数据完整性校验：写入前严格检查
  const check = isDataComplete({ word, translation, phrases: finalPhrases });
  if (!check.valid) {
    console.error(`❌ [autoAddVocabulary] 数据完整性校验失败: ${word}`, check.missingFields);
    throw new Error(
      `数据生成不完整，请尝试重新识别。缺失字段: ${check.missingFields.join(', ')}`
    );
  }

  console.log('📝 [autoAddVocabulary] 即将保存新词:', word, '例句数:', finalPhrases.length, '例句:', JSON.stringify(finalPhrases));

  // 写入完整记录
  const { error } = await supabase
    .from('user_notebook')
    .insert({
      user_id: userId,
      word: normalizedWord,
      translation,
      usage: usage || '',
      phrases: JSON.stringify(finalPhrases),
      image_path: imagePath || '',
      source,
    });

  if (error) {
    console.error(`❌ [autoAddVocabulary] 写入失败: ${word}`, error.message);
    throw new Error(`保存失败: ${error.message}`);
  }

  console.log('📝 [autoAddVocabulary] 写入完成，返回 saved');
  return 'saved';
}

/**
 * 检查单词是否已收藏（不区分来源）
 */
export async function isWordFavorited(word: string): Promise<boolean> {
  try {
    const userId = await getCurrentUserId();
    const normalizedWord = word.toLowerCase().trim();
    const { data, error } = await supabase
      .from('user_notebook')
      .select('id')
      .eq('user_id', userId)
      .eq('word', normalizedWord)
      .maybeSingle();

    if (error) {
      console.warn('[vocabularyService] isWordFavorited 查询失败:', error.message);
      return false;
    }
    return !!data;
  } catch {
    return false;
  }
}

/**
 * 检查单词在特定来源是否已收藏
 */
export async function isWordFavoritedBySource(word: string, source: 'camera' | 'search'): Promise<boolean> {
  try {
    const userId = await getCurrentUserId();
    const normalizedWord = word.toLowerCase().trim();
    const { data, error } = await supabase
      .from('user_notebook')
      .select('id')
      .eq('user_id', userId)
      .eq('word', normalizedWord)
      .eq('source', source)
      .maybeSingle();

    if (error) {
      console.warn('[vocabularyService] isWordFavoritedBySource 查询失败:', error.message);
      return false;
    }
    return !!data;
  } catch {
    return false;
  }
}

/**
 * 切换收藏状态（特定来源）- 立即响应版
 * 如果该来源未收藏 → 立即返回已收藏状态，后台异步生成例句并保存
 * 如果该来源已收藏 → 立即取消收藏
 * 
 * 优化体验：用户点击收藏后立即显示已收藏状态，AI 生成例句在后台静默完成
 */
export async function toggleFavorite(
  word: string,
  translation: string,
  phrases: Array<{ e: string; c: string }>,
  source: 'camera' | 'search' = 'search',
  usage?: string,
  imagePath?: string,
): Promise<{ favorited: boolean; message?: string }> {
  // 先检查用户是否登录
  try {
    await getCurrentUserId();
  } catch (loginError) {
    console.error(`❌ [toggleFavorite] 用户未登录，无法收藏: ${word}`);
    return { favorited: false, message: '请先登录' };
  }
  
  const exists = await isWordFavoritedBySource(word, source);
  if (exists) {
    // 已收藏，直接取消
    await removeVocabularyByWordAndSource(word, source);
    console.log(`📝 [toggleFavorite] 取消收藏: ${word}`);
    return { favorited: false };
  } else {
    // 未收藏：立即返回已收藏状态，后台异步完成收藏
    console.log(`📝 [toggleFavorite] 开始收藏: ${word} (source: ${source})`);
    
    // 创建异步任务，不等待完成
    performAsyncFavorite(word, translation, phrases, source, usage, imagePath).catch(error => {
      console.error(`❌ [toggleFavorite] 后台收藏失败: ${word}`, error?.message || error);
      // 失败不影响用户体验，用户已经看到收藏成功了
    });
    
    // 立即返回已收藏状态，让 UI 立即更新
    return { favorited: true };
  }
}

/**
 * 后台异步执行收藏操作
 * @param word 英文单词
 * @param translation 中文翻译
 * @param phrases 例句数组
 * @param source 来源
 * @param usage 用法说明
 * @param imagePath 图片路径
 */
async function performAsyncFavorite(
  word: string,
  translation: string,
  phrases: Array<{ e: string; c: string }>,
  source: 'camera' | 'search',
  usage?: string,
  imagePath?: string,
): Promise<void> {
  try {
    console.log(`🔄 [performAsyncFavorite] ========== 开始后台收藏: ${word} ==========`);
    console.log(`🔄 [performAsyncFavorite] 参数: source=${source}, translation=${translation}, phrases=${JSON.stringify(phrases)}`);
    
    // 步骤 1：再次检查是否已存在（防止重复）
    console.log(`🔄 [performAsyncFavorite] 步骤 1: 检查是否已存在`);
    const exists = await isWordFavoritedBySource(word, source);
    if (exists) {
      console.log(`📝 [performAsyncFavorite] 步骤 1: 单词已存在，跳过: ${word}`);
      return;
    }
    console.log(`✅ [performAsyncFavorite] 步骤 1: 单词不存在，可以收藏`);
    
    // 步骤 2：确保有例句（优先查询共享词库，未命中时调用 AI 生成）
    console.log(`🔄 [performAsyncFavorite] 步骤 2: 确保有例句（当前例句数: ${phrases.length}）`);
    const finalPhrases = await ensurePhrases(word, phrases, source, translation);
    console.log(`✅ [performAsyncFavorite] 步骤 2: 例句生成完成，共 ${finalPhrases.length} 条: ${JSON.stringify(finalPhrases)}`);
    
    // 步骤 3：添加到生词本
    console.log(`🔄 [performAsyncFavorite] 步骤 3: 添加到生词本`);
    const result = await addVocabulary(word, translation, finalPhrases, source, usage, imagePath);
    console.log(`✅ [performAsyncFavorite] 步骤 3: 添加完成，结果: ${result}`);
    
    console.log(`✅ [performAsyncFavorite] ========== 后台收藏完成: ${word} ==========`);
  } catch (error: any) {
    console.error(`❌ [performAsyncFavorite] ========== 后台收藏失败: ${word} ==========`);
    console.error(`❌ [performAsyncFavorite] 错误详情:`, error?.message || error);
    console.error(`❌ [performAsyncFavorite] 错误堆栈:`, error?.stack);
    throw error;
  }
}

/**
 * 根据单词名和来源删除
 */
export async function removeVocabularyByWordAndSource(word: string, source: 'camera' | 'search'): Promise<void> {
  try {
    const userId = await getCurrentUserId();
    const normalizedWord = word.toLowerCase().trim();
    const { error } = await supabase
      .from('user_notebook')
      .delete()
      .eq('user_id', userId)
      .eq('word', normalizedWord)
      .eq('source', source);

    if (error) {
      console.error(`❌ [removeVocabularyByWordAndSource] 删除失败: ${word} (${source})`, error.message);
    }
  } catch (err: any) {
    console.warn('[removeVocabularyByWordAndSource] 异常:', err?.message || err);
  }
}

/**
 * 根据单词名删除
 */
export async function removeVocabularyByWord(word: string): Promise<void> {
  try {
    const userId = await getCurrentUserId();
    const normalizedWord = word.toLowerCase().trim();
    const { error } = await supabase
      .from('user_notebook')
      .delete()
      .eq('user_id', userId)
      .eq('word', normalizedWord);

    if (error) {
      console.error(`❌ [removeVocabularyByWord] 删除失败: ${word}`, error.message);
    }
  } catch (err: any) {
    console.warn('[removeVocabularyByWord] 异常:', err?.message || err);
  }
}

/**
 * 获取所有生词
 */
export async function getVocabulary(): Promise<VocabEntry[]> {
  return loadAll();
}

/**
 * 根据 ID 删除
 */
export async function removeVocabulary(id: string): Promise<void> {
  try {
    const userId = await getCurrentUserId();
    const { error } = await supabase
      .from('user_notebook')
      .delete()
      .eq('user_id', userId)
      .eq('id', id);

    if (error) {
      console.error(`❌ [removeVocabulary] 删除失败: ${id}`, error.message);
    }
  } catch (err: any) {
    console.warn('[removeVocabulary] 异常:', err?.message || err);
  }
}

/**
 * 更新例句掌握度
 */
export async function updateSentenceMastery(id: string, score: number, sentenceText: string): Promise<void> {
  try {
    const userId = await getCurrentUserId();
    // 先读取当前值
    const { data: row } = await supabase
      .from('user_notebook')
      .select('sentence_mastery')
      .eq('user_id', userId)
      .eq('id', id)
      .single();

    let newScore: number;
    if (row?.sentence_mastery !== null && row?.sentence_mastery !== undefined) {
      newScore = Math.round(row.sentence_mastery * 0.6 + score * 0.4);
    } else {
      newScore = score;
    }

    const { error } = await supabase
      .from('user_notebook')
      .update({
        sentence_mastery: newScore,
        sentence_practiced: sentenceText,
      })
      .eq('user_id', userId)
      .eq('id', id);

    if (error) {
      console.warn('[vocabularyService] updateSentenceMastery 失败:', error.message);
    }
  } catch (err: any) {
    console.warn('[vocabularyService] updateSentenceMastery 异常:', err?.message || err);
  }
}

/**
 * 更新单词掌握度
 */
export async function updateMastery(id: string, score: number): Promise<void> {
  try {
    const userId = await getCurrentUserId();
    // 先读取当前值
    const { data: row } = await supabase
      .from('user_notebook')
      .select('mastery_score')
      .eq('user_id', userId)
      .eq('id', id)
      .single();

    let newScore: number;
    if (row?.mastery_score !== null && row?.mastery_score !== undefined) {
      newScore = Math.round(row.mastery_score * 0.6 + score * 0.4);
    } else {
      newScore = score;
    }

    const { error } = await supabase
      .from('user_notebook')
      .update({ mastery_score: newScore })
      .eq('user_id', userId)
      .eq('id', id);

    if (error) {
      console.warn('[vocabularyService] updateMastery 失败:', error.message);
    }
  } catch (err: any) {
    console.warn('[vocabularyService] updateMastery 异常:', err?.message || err);
  }
}

/**
 * 清空所有生词
 */
export async function clearVocabulary(): Promise<void> {
  try {
    const userId = await getCurrentUserId();
    const { error } = await supabase
      .from('user_notebook')
      .delete()
      .eq('user_id', userId);

    if (error) {
      console.error('❌ [clearVocabulary] 清空失败:', error.message);
      throw new Error(`清空失败: ${error.message}`);
    }
    console.log('📝 [clearVocabulary] 已清空所有生词');
  } catch (err: any) {
    console.warn('[clearVocabulary] 异常:', err?.message || err);
  }
}

/**
 * 搜索生词（按单词或翻译模糊匹配）
 */
export async function searchVocabulary(query: string): Promise<VocabEntry[]> {
  try {
    const userId = await getCurrentUserId();
    const q = query.toLowerCase();

    // Supabase 不支持跨字段 OR 模糊查询，所以先全量加载再过滤
    const { data, error } = await supabase
      .from('user_notebook')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('[vocabularyService] searchVocabulary 查询失败:', error.message);
      return [];
    }

    const all = (data || []).map((row: any) => rowToVocabEntry(row as NotebookRow));
    return all.filter(
      (e) => e.word.toLowerCase().includes(q) || e.translation.includes(query)
    );
  } catch (err: any) {
    console.warn('[vocabularyService] searchVocabulary 异常:', err?.message || err);
    return [];
  }
}
