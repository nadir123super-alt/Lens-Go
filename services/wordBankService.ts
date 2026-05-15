/**
 * 全球共享词库服务 - Supabase 云端词库
 *
 * 双轨制词库隔离逻辑：shared=拍照, search=查询
 * 
 * 提供对 shared_word_bank 和 search_word_bank 表的查询和写入操作。
 * 包含错误降级机制：Supabase 连接失败时返回 null，由调用方切换为 AI 模式。
 */
import { SharedWordBank, supabase } from './supabaseClient';

/**
 * 从云端词库查询单词详情
 * @param word 英文单词
 * @param tableName 词库表名（默认 shared_word_bank）
 * @returns 单词详情数据，未找到或出错时返回 null
 */
export async function fetchWordFromBank(word: string, tableName: string = 'shared_word_bank'): Promise<SharedWordBank | null> {
  if (!word) {
    throw new Error('缺少必要参数 word');
  }

  try {
    const { data, error } = await supabase
      .from(tableName)
      .select('*')
      .eq('word', word.toLowerCase())
      .single();

    if (error) {
      // PGRST116 = 未找到匹配行（不是错误，是正常未命中）
      if (error.code === 'PGRST116') {
        return null;
      }
      console.warn(`⚠️ Supabase 查询 ${tableName} 失败:`, error.message);
      return null;
    }

    console.log(`✅ Supabase ${tableName} 缓存命中: ${word}`);
    return data as SharedWordBank;
  } catch (error: any) {
    console.warn(`⚠️ Supabase 连接失败，切换到纯 AI 模式: ${error?.message || error}`);
    return null;
  }
}

/**
 * 将单词详情存入云端词库（upsert）
 * @param word 英文单词
 * @param definition 中文释义
 * @param example_en_1 英文例句 1
 * @param example_cn_1 中文翻译 1
 * @param example_en_2 英文例句 2
 * @param example_cn_2 中文翻译 2
 * @param tableName 词库表名（默认 shared_word_bank）
 * @returns 是否成功
 */
export async function upsertWordToBank(
  word: string,
  definition: string | null,
  example_en_1: string | null,
  example_cn_1: string | null,
  example_en_2: string | null,
  example_cn_2: string | null,
  tableName: string = 'shared_word_bank',
): Promise<boolean> {
  if (!word) {
    throw new Error('缺少必要参数 word');
  }

  try {
    const { error } = await supabase
      .from(tableName)
      .upsert({
        word: word.toLowerCase(),
        definition,
        example_en_1,
        example_cn_1,
        example_en_2,
        example_cn_2,
      }, {
        onConflict: 'word',
      });

    if (error) {
      console.warn(`⚠️ Supabase 存储 ${tableName} 失败:`, error.message);
      return false;
    }

    console.log(`✅ 单词 "${word}" 成功存入 ${tableName}`);
    return true;
  } catch (error: any) {
    console.warn(`⚠️ Supabase 存储异常，跳过云端同步: ${error?.message || error}`);
    return false;
  }
}
