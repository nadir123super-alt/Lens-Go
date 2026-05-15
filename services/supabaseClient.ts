import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

// 调试：检查连接地址（打印前 8 位用于核对环境）
const url = process.env.EXPO_PUBLIC_SUPABASE_URL || '(空)';
console.log('检查连接地址:', url);
console.log('Supabase URL 前 8 位:', url.substring(0, 8) + '...');
console.log('Anon Key 是否存在:', !!process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
console.log('Anon Key 前 8 位:', (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '').substring(0, 8) + '...');

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * 全球共享词库 - shared_word_bank 表结构
 *
 * 核心字段：
 * - word: 主键，英文单词（小写）
 * - definition: 中文释义/翻译
 * - example_en_1: 英文例句 1
 * - example_cn_1: 中文翻译 1
 * - example_en_2: 英文例句 2
 * - example_cn_2: 中文翻译 2
 */
export interface SharedWordBank {
  id?: string;
  word: string;
  definition: string | null;
  example_en_1: string | null;
  example_cn_1: string | null;
  example_en_2: string | null;
  example_cn_2: string | null;
  created_at?: string;
  updated_at?: string;
}