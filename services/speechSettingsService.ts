/**
 * SpeechSettingsService — 语音偏好设置服务
 *
 * 职责：
 * 1. 使用 AsyncStorage 持久化存储用户的语速偏好 (speech_rate)
 * 2. 提供全局可读的语速变量，供 soundManager 实时读取
 * 3. 默认语速为 1.0，范围 0.5 ~ 2.0，步长 0.1
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY_SPEECH_RATE = '@myaienglish/speech_rate';

/** 默认语速 */
const DEFAULT_SPEECH_RATE = 1.0;

/** 语速范围 */
export const MIN_SPEECH_RATE = 0.5;
export const MAX_SPEECH_RATE = 2.0;
export const SPEECH_RATE_STEP = 0.1;

// ====== 内存缓存（避免每次发音都读 AsyncStorage）======

/** 当前语速的内存缓存 */
let _cachedSpeechRate: number = DEFAULT_SPEECH_RATE;

/**
 * 获取当前语速（内存缓存，极快）
 * 适用于 TTS 发音时的实时读取
 */
export function getSpeechRate(): number {
  return _cachedSpeechRate;
}

/**
 * 从 AsyncStorage 加载语速到内存缓存
 * 应在 App 启动时调用一次
 */
export async function loadSpeechRate(): Promise<number> {
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
    console.warn('[SpeechSettings] 读取语速失败，使用默认值:', e);
  }
  _cachedSpeechRate = DEFAULT_SPEECH_RATE;
  return DEFAULT_SPEECH_RATE;
}

/**
 * 保存语速到 AsyncStorage 并更新内存缓存
 * @param rate 语速值 (0.5 ~ 2.0)
 */
export async function saveSpeechRate(rate: number): Promise<void> {
  const clamped = Math.min(MAX_SPEECH_RATE, Math.max(MIN_SPEECH_RATE, rate));
  const rounded = Math.round(clamped * 10) / 10; // 保留一位小数
  _cachedSpeechRate = rounded;
  try {
    await AsyncStorage.setItem(STORAGE_KEY_SPEECH_RATE, String(rounded));
  } catch (e) {
    console.warn('[SpeechSettings] 保存语速失败:', e);
  }
}
