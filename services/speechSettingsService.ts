/**
 * SpeechSettingsService — 语音偏好设置服务
 *
 * 职责：
 * 1. 使用 Supabase 持久化存储用户的语速偏好 (speech_rate)
 * 2. 提供全局可读的语速变量，供 soundManager 实时读取
 * 3. 默认语速为 1.0，范围 0.5 ~ 2.0，步长 0.1
 * 4. 离线降级：无网络时读取 AsyncStorage 缓存，联网后自动同步至 Supabase
 */
import { supabase } from '@/services/supabaseClient';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY_SPEECH_RATE = '@lensgo/speech_rate';

/** 默认语速 */
const DEFAULT_SPEECH_RATE = 1.0;

/** 语速范围 */
export const MIN_SPEECH_RATE = 0.5;
export const MAX_SPEECH_RATE = 2.0;
export const SPEECH_RATE_STEP = 0.1;

// ====== 内存缓存（避免每次发音都读 AsyncStorage / Supabase）======

/** 当前语速的内存缓存 */
let _cachedSpeechRate: number = DEFAULT_SPEECH_RATE;
/** AI 通话模块的临时语速覆盖（为 null 时使用全局语速） */
let _aiConversationRateOverride: number | null = null;

/**
 * 获取当前语速（内存缓存，极快）
 * 适用于 TTS 发音时的实时读取
 */
export function getSpeechRate(): number {
  // 如果 AI 通话模块设置了临时语速覆盖，优先使用
  if (_aiConversationRateOverride !== null) {
    return _aiConversationRateOverride;
  }
  return _cachedSpeechRate;
}

/**
 * 设置 AI 通话模块的临时语速覆盖
 * 只影响 AI 通话模块的 TTS 朗读，不影响其他模块
 * @param rate 语速值 (0.5 ~ 2.0)，传 null 恢复全局语速
 */
export function setAiConversationRate(rate: number | null): void {
  if (rate === null) {
    _aiConversationRateOverride = null;
  } else {
    _aiConversationRateOverride = Math.min(MAX_SPEECH_RATE, Math.max(MIN_SPEECH_RATE, rate));
  }
}

/**
 * 获取当前登录用户 ID
 */
async function getCurrentUserId(): Promise<string | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id || null;
  } catch {
    return null;
  }
}

/**
 * 从 Supabase 加载语速到内存缓存
 * 如果 Supabase 读取失败，降级到 AsyncStorage
 * 应在 App 启动时调用一次
 */
export async function loadSpeechRate(): Promise<number> {
  // 先尝试从 Supabase 加载
  const userId = await getCurrentUserId();
  if (userId) {
    try {
      const { data, error } = await supabase
        .from('user_settings')
        .select('speech_rate')
        .eq('user_id', userId)
        .maybeSingle();

      if (!error && data && data.speech_rate != null) {
        const rate = data.speech_rate;
        if (rate >= MIN_SPEECH_RATE && rate <= MAX_SPEECH_RATE) {
          _cachedSpeechRate = rate;
          // 同步到 AsyncStorage 作为离线缓存
          await AsyncStorage.setItem(STORAGE_KEY_SPEECH_RATE, String(rate));
          return rate;
        }
      }
    } catch (e) {
      console.warn('[SpeechSettings] Supabase 读取语速失败，降级到 AsyncStorage:', e);
    }
  }

  // 降级：从 AsyncStorage 读取
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY_SPEECH_RATE);
    if (stored !== null) {
      const rate = parseFloat(stored);
      if (!isNaN(rate) && rate >= MIN_SPEECH_RATE && rate <= MAX_SPEECH_RATE) {
        _cachedSpeechRate = rate;
        return rate;
      }
    }
  } catch (e) {
    console.warn('[SpeechSettings] AsyncStorage 读取语速失败，使用默认值:', e);
  }

  _cachedSpeechRate = DEFAULT_SPEECH_RATE;
  return DEFAULT_SPEECH_RATE;
}

/**
 * 保存语速到 Supabase 并更新内存缓存
 * 如果 Supabase 写入失败，降级到 AsyncStorage
 * @param rate 语速值 (0.5 ~ 2.0)
 */
export async function saveSpeechRate(rate: number): Promise<void> {
  const clamped = Math.min(MAX_SPEECH_RATE, Math.max(MIN_SPEECH_RATE, rate));
  const rounded = Math.round(clamped * 10) / 10; // 保留一位小数
  _cachedSpeechRate = rounded;

  // 始终写入 AsyncStorage 作为离线缓存
  try {
    await AsyncStorage.setItem(STORAGE_KEY_SPEECH_RATE, String(rounded));
  } catch (e) {
    console.warn('[SpeechSettings] AsyncStorage 保存语速失败:', e);
  }

  // 尝试同步到 Supabase
  const userId = await getCurrentUserId();
  if (userId) {
    try {
      const { error } = await supabase
        .from('user_settings')
        .upsert({
          user_id: userId,
          speech_rate: rounded,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'user_id',
        });

      if (error) {
        console.warn('[SpeechSettings] Supabase 保存语速失败，已降级到本地缓存:', error);
      }
    } catch (e) {
      console.warn('[SpeechSettings] Supabase 保存语速异常，已降级到本地缓存:', e);
    }
  }
}
