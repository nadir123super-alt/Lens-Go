/**
 * dictionaryService — 本地词典查询服务（SQLite + expo-file-system）
 *
 * 策略：
 *   1. app 启动时用 downloadAsync 下载 assets/dictionary.db 到文档目录
 *   2. 使用 expo-sqlite 打开文档目录中的数据库
 *   3. 所有查询走 SQLite（毫秒级）
 *
 * 搜索逻辑（v2）：
 *   - 支持英文原词和中文含义双向模糊查询
 *   - 多字段匹配：同时检索 word（英文）和 translation（中文翻译）字段
 *   - 优先级排序：英文完全匹配 > 英文前缀匹配 > 中文包含匹配 > 英文模糊匹配
 */
import { copyAsync, documentDirectory, downloadAsync, getInfoAsync } from 'expo-file-system/legacy';
import { Platform } from 'react-native';

export interface DictResult {
  word: string;
  phonetic: string;
  definition: string;
  translation: string;
}

// ── SQLite 单例 ──
let _db: import('expo-sqlite').SQLiteDatabase | null = null;
let _dbReady = false;
let _dbInitPromise: Promise<void> | null = null;

const DB_FILENAME = 'dictionary.db';
const DB_DEST_DIR = documentDirectory; // e.g. file:///data/data/host.exp.exponent/files/

/**
 * 将 bundled asset 中的 dictionary.db 下载到文档目录
 * 用 downloadAsync 兼容 Expo Go HTTP 环境
 */
async function copyDatabaseFromAsset(): Promise<string> {
  const destUri = DB_DEST_DIR + DB_FILENAME;
  console.log('[dict] 目标路径:', destUri);

  // 1. 如果已存在且大小 > 0，跳过
  const destInfo = await getInfoAsync(destUri);
  if (destInfo.exists && (destInfo as any).size > 0) {
    console.log('[dict] 数据库已存在，跳过下载。大小:', (destInfo as any).size, 'bytes');
    return destUri;
  }

  // 2. 获取 asset URI（开发模式下是 http://，生产构建是 file://）
  console.log('[dict] 正在获取 asset URI...');
  const Asset = require('expo-asset').Asset;
  const asset = Asset.fromModule(require('@/assets/dictionary.db'));

  // 确保 asset 元数据已加载（轻量请求）
  await asset.downloadAsync();
  const assetUri: string = asset.localUri ?? asset.uri;
  console.log('[dict] Asset URI:', assetUri);

  if (!assetUri) {
    throw new Error('无法获取 dictionary.db 的 asset URI');
  }

  // 3. 根据源协议选择传输方式：file:// 用 copyAsync，http(s):// 用 downloadAsync
  console.log('[dict] 正在传输数据库...');
  if (assetUri.startsWith('file://')) {
    await copyAsync({ from: assetUri, to: destUri });
    console.log('[dict] ✅ copyAsync 完成');
  } else {
    const result = await downloadAsync(assetUri, destUri);
    console.log('[dict] ✅ downloadAsync 完成, status:', result.status);
  }
  return destUri;
}

// 初始化 DB
export async function initDictionary(): Promise<void> {
  if (Platform.OS === 'web') { _dbReady = true; return; }
  if (_dbReady) return;
  if (_dbInitPromise) return _dbInitPromise;

  _dbInitPromise = (async () => {
    try {
      // 1. 确保数据库文件在文档目录中
      const dbPath = await copyDatabaseFromAsset();

      // 2. 打开 SQLite
      console.log('[dict] 打开数据库:', dbPath);
      const SQLite = require('expo-sqlite');
      _db = await SQLite.openDatabaseAsync(dbPath);
      // 3. 验证表存在
      const row = await _db!.getFirstAsync<{ cnt: number }>(
        'SELECT COUNT(*) as cnt FROM words'
      );
      console.log(`[dict] ✅ SQLite 词典就绪，共 ${row?.cnt ?? 0} 词`);
      _dbReady = true;
    } catch (err) {
      console.error('[dict] ❌ SQLite 加载失败:', err);
      _dbReady = true; // 标记为已尝试，避免重复初始化
    }
  })();

  return _dbInitPromise;
}

/**
 * 判断字符串是否包含中文字符
 */
function isChineseQuery(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text);
}

/**
 * 英汉双向模糊搜索（SQLite）
 *
 * 搜索策略：
 *   1. 英文完全匹配 → 排第一
 *   2. 英文前缀匹配（word LIKE 'key%'）
 *   3. 中文包含匹配（translation LIKE '%key%'）
 *   4. 英文包含匹配（word LIKE '%key%'）
 *
 * @param query  - 搜索关键词（英文或中文）
 * @param topK   - 最大返回条数
 */
export async function fuzzySearch(query: string, topK = 20): Promise<DictResult[]> {
  if (Platform.OS === 'web') return [];
  const key = query.trim().toLowerCase();
  if (!key) return [];

  try {
    await initDictionary();
    if (!_db) return [];

    const isChinese = isChineseQuery(key);

    let sql: string;
    let params: string[];

    if (isChinese) {
      // 中文搜索：只匹配 translation 字段
      sql = `
        SELECT word, phonetic, definition, translation
        FROM words
        WHERE translation LIKE ?
        ORDER BY
          CASE
            WHEN translation = ? THEN 0
            WHEN translation LIKE ? THEN 1
            ELSE 2
          END,
          LENGTH(word) ASC
        LIMIT ?
      `;
      params = [`%${key}%`, key, `${key}%`, String(topK)];
    } else {
      // 英文搜索：匹配 word 和 translation 字段，优先级排序
      sql = `
        SELECT word, phonetic, definition, translation
        FROM words
        WHERE word LIKE ? OR translation LIKE ?
        ORDER BY
          CASE
            WHEN word = ? THEN 0
            WHEN word LIKE ? THEN 1
            WHEN translation LIKE ? THEN 2
            ELSE 3
          END,
          LENGTH(word) ASC
        LIMIT ?
      `;
      params = [`%${key}%`, `%${key}%`, key, `${key}%`, `%${key}%`, String(topK)];
    }

    const rows = await _db.getAllAsync<{
      word: string; phonetic: string; definition: string; translation: string;
    }>(sql, params);

    return rows.map(row => ({
      word: row.word,
      phonetic: row.phonetic || '',
      definition: row.definition || '',
      translation: row.translation || '',
    }));
  } catch (err) {
    console.warn('[dict] fuzzySearch SQLite 失败:', err);
    return [];
  }
}

// ── 精确查询（SQLite） ──
export async function exactMatch(word: string): Promise<DictResult | null> {
  if (Platform.OS === 'web') return null;
  const key = word.trim().toLowerCase();
  if (!key) return null;

  try {
    await initDictionary();
    if (!_db) return null;

    const row = await _db.getFirstAsync<{
      word: string; phonetic: string; definition: string; translation: string;
    }>(
      'SELECT word, phonetic, definition, translation FROM words WHERE word = ? LIMIT 1',
      [key]
    );
    if (row) {
      return {
        word: row.word,
        phonetic: row.phonetic || '',
        definition: row.definition || '',
        translation: row.translation || '',
      };
    }
  } catch (err) {
    console.warn('[dict] exactMatch SQLite 失败:', err);
  }
  return null;
}
