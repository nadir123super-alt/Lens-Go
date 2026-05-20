import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

/**
 * Supabase 客户端
 *
 * ★ 关键配置：使用 AsyncStorage 持久化 session
 * 默认情况下，supabase-js 在 React Native 中使用内存存储来保存 session。
 * 当应用进入后台被系统回收、或 JavaScript 环境重新初始化时，session 会丢失。
 * 配置 AsyncStorage 适配器后，session 会被持久化到磁盘，
 * 应用重启或从后台恢复时能自动恢复登录状态。
 */
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

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