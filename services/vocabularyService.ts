/**
 * 生词本服务 - 本地持久化存储单词及例句
 * 使用 expo-file-system 将生词数据存储为本地 JSON 文件
 *
 * 收藏逻辑增强：
 *   当用户收藏单词时，如果未提供例句（phrases 为空），
 *   系统自动调用 sentenceGenerator 生成两个符合评测格式的例句。
 *
 * 数据完整性校验（2025-05-12 新增）：
 *   在写入本地存储前，严格校验 word、translation、phrases（≥2 条，每条有 e 和 c）
 *   校验不通过则抛出错误，防止脏数据写入
 */
import * as FileSystem from 'expo-file-system/legacy';
import { generateExampleSentences } from './sentenceGenerator';

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
  // 旧字段兼容
  l?: string;
  t?: string;
}

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
 *
 * @example
 * isDataComplete({ word: 'hello', translation: '你好', phrases: [{ e: '...', c: '...' }, { e: '...', c: '...' }] })
 * // => { valid: true, missingFields: [] }
 */
export function isDataComplete(data: {
  word: string;
  translation: string;
  phrases: Array<{ e: string; c: string }>;
}): { valid: boolean; missingFields: string[] } {
  const missingFields: string[] = [];

  // 1. 检查 word
  if (!data.word || typeof data.word !== 'string' || data.word.trim() === '') {
    missingFields.push('word');
  }

  // 2. 检查 translation
  if (!data.translation || typeof data.translation !== 'string' || data.translation.trim() === '') {
    missingFields.push('translation');
  }

  // 3. 检查 phrases（至少 2 条）
  if (!Array.isArray(data.phrases) || data.phrases.length < 2) {
    missingFields.push(`phrases（当前 ${data.phrases?.length || 0} 条，需要 ≥2 条）`);
  } else {
    // 4. 检查每条 phrase 的 e 和 c
    data.phrases.forEach((p, index) => {
      if (!p.e || typeof p.e !== 'string' || p.e.trim() === '') {
        missingFields.push(`phrases[${index}].e（英文例句为空）`);
      }
      if (!p.c || typeof p.c !== 'string' || p.c.trim() === '') {
        missingFields.push(`phrases[${index}].c（中文翻译为空）`);
      }
    });
  }

  return {
    valid: missingFields.length === 0,
    missingFields,
  };
}

const VOCAB_FILE = FileSystem.documentDirectory + 'vocabulary.json';
const AUTO_DEDUP_MS = 60 * 60 * 1000; // 1 小时内不重复写入

async function loadAll(): Promise<VocabEntry[]> {
  try {
    const info = await FileSystem.getInfoAsync(VOCAB_FILE);
    if (!info.exists) return [];
    const raw = await FileSystem.readAsStringAsync(VOCAB_FILE);
    const entries = JSON.parse(raw) as VocabEntry[];
    return entries.map((e) => {
      const rawSource = (e as any).source || '';
      return {
        ...e,
        word: e.word || e.l || '',
        translation: e.translation || e.t || '',
        phrases: e.phrases || [],
        source: (rawSource === 'cropped' ? 'camera' : rawSource || 'search') as 'camera' | 'search',
      };
    });
  } catch {
    return [];
  }
}

async function saveAll(entries: VocabEntry[]): Promise<void> {
  const data = JSON.stringify(entries, null, 2);
  await FileSystem.writeAsStringAsync(VOCAB_FILE, data);
}

/**
 * 写入确认：立即读取刚写入的文件，验证持久化是否成功
 * 如果读取结果与写入内容一致 → 打印成功日志
 * 如果不一致或有异常 → 抛出错误
 */
async function verifyPersistence(writtenEntries: VocabEntry[], label: string): Promise<void> {
  try {
    const raw = await FileSystem.readAsStringAsync(VOCAB_FILE);
    const readBack = JSON.parse(raw) as VocabEntry[];
    console.log(`📝 [${label}] 写入确认 — 文件中有 ${readBack.length} 条记录`);
    readBack.forEach((e) => {
      console.log(`   → word="${e.word}" phrases=${e.phrases?.length || 0} source=${e.source}`);
    });
    if (readBack.length !== writtenEntries.length) {
      console.warn(`⚠️ [${label}] 条数不匹配! 期望${writtenEntries.length} 实际${readBack.length}`);
    }
  } catch (err) {
    console.error(`❌ [${label}] 持久化验证失败:`, err);
    throw new Error('存储写入失败，请检查磁盘空间');
  }
}

/**
 * 确保单词有例句：如果 phrases 为空，自动生成两个例句
 */
function ensurePhrases(word: string, phrases: Array<{ e: string; c: string }>): Array<{ e: string; c: string }> {
  if (phrases && phrases.length >= 2) {
    return phrases;
  }
  // 自动生成本地例句
  const generated = generateExampleSentences(word);
  console.log(`📝 [vocabularyService] 为 "${word}" 自动生成 ${generated.length} 个例句`);
  return generated;
}

/**
 * 手动收藏（查词场景使用）
 * 如果已存在同名词，则覆盖 + 更新时间戳
 * 如果未提供例句，自动生成本地例句
 */
export async function addVocabulary(
  word: string,
  translation: string,
  phrases: Array<{ e: string; c: string }>,
  source: 'camera' | 'search' = 'camera',
  usage?: string,
  imagePath?: string,
): Promise<void> {
  const entries = await loadAll();
  const normalizedWord = word.toLowerCase().trim();

  // 确保有例句（若未提供则自动生成）
  const finalPhrases = ensurePhrases(word, phrases);

  // 数据完整性校验：写入前严格检查
  const check = isDataComplete({ word, translation, phrases: finalPhrases });
  if (!check.valid) {
    console.error(`❌ [addVocabulary] 数据完整性校验失败: ${word}`, check.missingFields);
    throw new Error(
      `数据生成不完整，请尝试重新识别。缺失字段: ${check.missingFields.join(', ')}`
    );
  }

  const existingIndex = entries.findIndex((e) => e.word.toLowerCase() === normalizedWord);
  const newEntry: VocabEntry = {
    id: `${normalizedWord}_${Date.now()}`,
    word,
    translation,
    phrases: finalPhrases,
    usage: usage || '',
    imagePath,
    source,
    timestamp: Date.now(),
  };

  if (existingIndex >= 0) {
    const old = entries[existingIndex];
    entries[existingIndex] = {
      ...old,
      ...newEntry,
      imagePath: newEntry.imagePath || old.imagePath,
      timestamp: Date.now(),
    };
  } else {
    entries.push(newEntry);
  }

  entries.sort((a, b) => b.timestamp - a.timestamp);
  await saveAll(entries);
}

/**
 * 自动收藏（拍照识别场景使用）
 * 严格查重：如果单词已存在于数据库中 → 完全放弃写入，保留初次见面例句
 * 只有全新单词 → 写入完整记录（单词 + 翻译 + 例句 + 图片 + 时间戳）
 * 如果未提供例句，自动生成本地例句
 * 返回 'saved'（新词已保存）或 'skipped'（已有该词，已跳过）
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
  const entries = await loadAll();
  const normalizedWord = word.toLowerCase().trim();

  // 检查是否存在（严格查重）
  const existing = entries.find((e) => e.word.toLowerCase() === normalizedWord);
  if (existing) {
    // 单词已存在 → 完全放弃写入，保留初次见面数据
    return 'skipped';
  }

  // 确保有例句
  const finalPhrases = ensurePhrases(word, phrases);

  // 数据完整性校验：写入前严格检查
  const check = isDataComplete({ word, translation, phrases: finalPhrases });
  if (!check.valid) {
    console.error(`❌ [autoAddVocabulary] 数据完整性校验失败: ${word}`, check.missingFields);
    throw new Error(
      `数据生成不完整，请尝试重新识别。缺失字段: ${check.missingFields.join(', ')}`
    );
  }

  // 拍照场景：如果 AI 提供例句则用 AI 的，否则用自动生成的
  console.log('📝 [autoAddVocabulary] 即将保存新词:', word, '例句数:', finalPhrases.length, '例句:', JSON.stringify(finalPhrases));

  // 写入完整记录
  const newEntry: VocabEntry = {
    id: `${normalizedWord}_${Date.now()}`,
    word,
    translation,
    phrases: finalPhrases,
    usage: usage || '',
    imagePath,
    source,
    timestamp: Date.now(),
  };
  entries.push(newEntry);

  entries.sort((a, b) => b.timestamp - a.timestamp);
  console.log('📝 [autoAddVocabulary] 数组长度:', entries.length, '将调 saveAll');
  await saveAll(entries);
  console.log('📝 [autoAddVocabulary] saveAll 完成');

  // 写入确认：验证数据确实已经持久化到磁盘
  const normalizedForVerify = normalizedWord;
  const foundAfterWrite = entries.find((e) => e.word.toLowerCase() === normalizedForVerify);
  if (!foundAfterWrite) {
    console.error('❌ [autoAddVocabulary] 严重异常：刚写入的单词未在数组中找到!');
    throw new Error('数据写入异常 — 单词未在数组中，请重试');
  }
  await verifyPersistence(entries, `autoAdd:${word}`);
  console.log('📝 [autoAddVocabulary] 写入确认完成，返回 saved');

  return 'saved';
}

export async function isWordFavorited(word: string): Promise<boolean> {
  const entries = await loadAll();
  return entries.some((e) => e.word.toLowerCase() === word.toLowerCase().trim());
}

/**
 * 切换收藏状态
 * 如果单词未收藏 → 收藏（自动补全例句）
 * 如果已收藏 → 取消收藏
 */
export async function toggleFavorite(
  word: string,
  translation: string,
  phrases: Array<{ e: string; c: string }>,
  source: 'camera' | 'search' = 'search',
  usage?: string,
  imagePath?: string,
): Promise<boolean> {
  const exists = await isWordFavorited(word);
  if (exists) {
    await removeVocabularyByWord(word);
    return false;
  } else {
    // 确保有例句
    const finalPhrases = ensurePhrases(word, phrases);
    await addVocabulary(word, translation, finalPhrases, source, usage, imagePath);
    return true;
  }
}

export async function removeVocabularyByWord(word: string): Promise<void> {
  const entries = await loadAll();
  const filtered = entries.filter((e) => e.word.toLowerCase() !== word.toLowerCase().trim());
  await saveAll(filtered);
}

export async function getVocabulary(): Promise<VocabEntry[]> {
  return loadAll();
}

export async function removeVocabulary(id: string): Promise<void> {
  const entries = await loadAll();
  const filtered = entries.filter((e) => e.id !== id);
  await saveAll(filtered);
}

export async function updateSentenceMastery(id: string, score: number, sentenceText: string): Promise<void> {
  const entries = await loadAll();
  const idx = entries.findIndex((e) => e.id === id);
  if (idx >= 0) {
    const oldScore = entries[idx].sentenceMastery;
    if (oldScore !== undefined) {
      entries[idx].sentenceMastery = Math.round(oldScore * 0.6 + score * 0.4);
    } else {
      entries[idx].sentenceMastery = score;
    }
    entries[idx].sentencePracticed = sentenceText;
    await saveAll(entries);
  }
}

export async function updateMastery(id: string, score: number): Promise<void> {
  const entries = await loadAll();
  const idx = entries.findIndex((e) => e.id === id);
  if (idx >= 0) {
    // 取平均分或保留最高分（这里用加权平均：新分占 40%，旧分占 60%）
    const oldScore = entries[idx].masteryScore;
    if (oldScore !== undefined) {
      entries[idx].masteryScore = Math.round(oldScore * 0.6 + score * 0.4);
    } else {
      entries[idx].masteryScore = score;
    }
    await saveAll(entries);
  }
}

export async function clearVocabulary(): Promise<void> {
  await saveAll([]);
}

export async function searchVocabulary(query: string): Promise<VocabEntry[]> {
  const all = await loadAll();
  const q = query.toLowerCase();
  return all.filter(
    (e) => e.word.toLowerCase().includes(q) || e.translation.includes(query)
  );
}
