/**
 * SoundManager — 全局音频播放管理器
 *
 * 职责：
 * 1. 全局跟踪当前正在播放的 TTS 实例
 * 2. "即点即停"：播放新音频前自动停止当前播放
 * 3. "退出即停"：提供 cleanup() 供 useEffect 卸载时调用
 * 4. 支持全局语速调节：读取 speechSettingsService 中的语速值
 * 5. 模拟字符级进度回调，实现"KTV式"高亮效果
 */
import * as Speech from 'expo-speech';
import { Platform } from 'react-native';
import {
  getAudioPlayCompleteCount,
  getWordClickCounts,
  incrementAudioPlayCompleteCount,
  incrementPageLocalCount,
  recordWordClick
} from '../utils/audioCounter';
import { getSpeechRate } from './speechSettingsService';
import { cleanTextForSpeech } from './textCleaner';

// ====== 语速基准校准 ======
// BASE_RATE = 0.9：将系统当前的 0.9x 物理语速设定为新的 1.0x 标准语速。
// UI 上显示 1.0x 时，实际传给 TTS 引擎的参数为 1.0 * BASE_RATE = 0.9，
// 确保用户听到的"标准语速"更从容、更自然。
const BASE_RATE = 0.9;

// ====== 音量增强 ======

/**
 * 在 TTS 播放前，重新配置音频会话以确保最大音量输出。
 * - iOS: 使用 useApplicationAudioSession=false 让 TTS 使用独立音频会话
 * - Android: 重新设置 Audio.setAudioModeAsync 确保扬声器输出
 *
 * ⚠️ expo-speech 的 volume 参数在官方版本中是 web-only（@platform web），
 * 但我们已修补了原生模块：
 *   - Android: SpeechModule.kt 中传递 KEY_PARAM_VOLUME=1.0 到 TextToSpeech.speak()
 *   - iOS: SpeechModule.swift 中设置 AVSpeechUtterance.volume=1.0
 * 因此 volume: 1.0 现在在原生层生效。
 *
 * 戴耳机时声音偏小是耳机物理特性（振膜小、阻抗高），
 * 软件层面已最大化输出增益。
 */
let _ensureAudioSession: (() => Promise<void>) | null = null;

// 计数器已迁移至 utils/audioCounter.ts
// 通过 import 使用 getAudioPlayCompleteCount / incrementAudioPlayCompleteCount 等

export function setAudioSessionEnsurer(fn: () => Promise<void>): void {
  _ensureAudioSession = fn;
}

async function ensureMaxVolumeBeforeSpeak(): Promise<void> {
  // 调用外部注入的音频会话强化函数（来自 recordingService.ts）
  if (_ensureAudioSession) {
    try {
      await _ensureAudioSession();
    } catch {
      // 静默失败，不影响 TTS 播放
    }
  }
}

type AudioSource =
  | { type: 'tts'; text: string };

let current: {
  source: AudioSource;
} | null = null;

// 进度定时器引用（模块级别，以便 stopAll 可以访问）
let progressTimer: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval> | null = null;

/**
 * 停止当前所有播放
 * - 停止 TTS（expo-speech）
 * - 清除进度定时器
 * - 清除内部引用
 */
export function stopAll(): void {
  console.log('[SoundManager] stopAll()');
  
  // expo-speech 全局停止所有 TTS 语音
  Speech.stop();

  // 清除进度定时器
  if (progressTimer) {
    clearTimeout(progressTimer);
    progressTimer = null;
  }

  // 重置引用
  current = null;
}

/**
 * 播放文本语音（TTS）
 * 如果当前有正在播放的音频，先停止再播放新的
 *
 * @param text 要朗读的英文文本
 * @param onDone 可选回调，播放完毕后执行
 * @param onProgress 可选回调，播放进度更新时执行（返回已播放字符数）
 * @param word 可选，当前单词（用于成就追踪）
 */
export function playText(
  text: string,
  onDone?: () => void,
  onProgress?: (progress: number) => void,
  word?: string,
): void {
  console.log(`[SoundManager] playText() 被调用: "${text.substring(0, 50)}..."`);

  // "即点即停"：先停止当前语音
  if (current) {
    console.log('[SoundManager] 停止当前播放');
    stopAll();
  }

  const cleanedText = cleanTextForSpeech(text);
  if (!cleanedText || cleanedText.trim().length === 0) {
    console.warn('[SoundManager] 文本为空，跳过播放');
    return;
  }

  // 直接使用 expo-speech 播放
  playWithExpoSpeech(cleanedText, onDone, onProgress, word);
}

/**
 * 使用 expo-speech（系统原生 TTS）播放
 */
function playWithExpoSpeech(
  text: string,
  onDone?: () => void,
  onProgress?: (progress: number) => void,
  word?: string
): void {
  console.log('[SoundManager] ===== 使用 expo-speech =====');
  
  // 注册为 TTS 播放
  current = { source: { type: 'tts', text } };

  const callback = onDone
    ? () => {
        onDone();
        if (current?.source.type === 'tts' && current.source.text === text) {
          current = null;
        }
      }
    : undefined;

  const totalLength = text.length;
  let currentProgress = 0;
  
  if (onProgress) {
    const getCharDuration = (char: string, index: number, text: string): number => {
      const vowels = 'aeiouAEIOU';
      const shortConsonants = 'ptkbdg';
      const longConsonants = 'mnlrsw';
      const diphthongs = ['ai', 'ay', 'ea', 'ee', 'ei', 'ey', 'ie', 'oa', 'oe', 'oi', 'oy', 'oo', 'ou', 'ow', 'ui'];
      
      const c = char.toLowerCase();
      const prevChar = index > 0 ? text[index - 1].toLowerCase() : '';
      const nextChar = index < text.length - 1 ? text[index + 1].toLowerCase() : '';
      const isPartOfDiphthong = diphthongs.includes(prevChar + c) || diphthongs.includes(c + nextChar);
      
      if (vowels.includes(char)) {
        if (isPartOfDiphthong) return 180;
        const isStressed = index === 0 || (index > 0 && text[index - 1] === ' ');
        return isStressed ? 140 : 100;
      } else if (shortConsonants.includes(c)) {
        return 45;
      } else if (longConsonants.includes(c)) {
        return 75;
      } else if (c === 'h' || c === 'y') {
        return 35;
      } else {
        return 55;
      }
    };
    
    const charDurations: number[] = [];
    for (let i = 0; i < text.length; i++) {
      charDurations.push(getCharDuration(text[i], i, text));
    }
    
    const speedFactor = (1 / BASE_RATE) * 0.95;
    
    const scheduleNext = (index: number) => {
      if (index >= text.length) {
        onProgress(text.length);
        return;
      }
      
      const duration = charDurations[index] * speedFactor;
      
      progressTimer = setTimeout(() => {
        currentProgress = index + 1;
        onProgress(currentProgress);
        scheduleNext(index + 1);
      }, duration) as unknown as ReturnType<typeof setInterval>;
    };
    
    scheduleNext(0);
  }

  ensureMaxVolumeBeforeSpeak().then(() => {
    const userRate = getSpeechRate();
    const adjustedRate = userRate * BASE_RATE;

    console.log(`[SoundManager] Speech.speak() 即将调用: text="${text.substring(0, 30)}...", rate=${adjustedRate}, language=en`);

    const ttsOptions: any = {
      language: 'en',
      rate: adjustedRate,
      pitch: 1.0,
      volume: 1.0,
      onDone: () => {
        console.log('[SoundManager] expo-speech 播放完成');
        if (progressTimer) clearTimeout(progressTimer);
        if (onProgress && currentProgress < totalLength) {
          onProgress(totalLength);
        }
        
        trackAchievements(word);
        
        if (callback) callback();
      },
      onError: (error: any) => {
        if (progressTimer) clearTimeout(progressTimer);
        console.warn('[SoundManager] TTS 播放出错:', error?.message || error, 'text:', text);
        current = null;
      },
    };

    if (Platform.OS === 'ios') {
      ttsOptions.useApplicationAudioSession = false;
    }

    try {
      Speech.speak(text, ttsOptions);
      console.log('[SoundManager] Speech.speak() 调用成功');
    } catch (e: any) {
      console.error('[SoundManager] Speech.speak() 抛出异常:', e?.message || e);
    }
  });
}

/**
 * 成就追踪（播放完成后的成就检查）
 */
async function trackAchievements(word?: string): Promise<void> {
  // 音频完整播放完毕，增加计数器（用于"复读机"勋章）
  incrementAudioPlayCompleteCount();
  incrementPageLocalCount();
  
  // 使用内存计数器检查（用于"复读机"勋章）
  const currentCount = getAudioPlayCompleteCount();
  
  // 每 10 次检查一次勋章解锁（避免频繁查询）
  if (currentCount % 10 === 0) {
    import('./achievementService').then(({ checkRepeaterAchievement }) => {
      checkRepeaterAchievement(currentCount).then((newlyUnlocked) => {
        if (newlyUnlocked) {
          (global as any).__pendingUnlockBadges = ['repeater'];
        }
      }).catch((e: any) =>
        console.warn('   ⚠️ 检查复读机勋章失败:', e)
      );
    }).catch((e: any) =>
      console.warn('   ⚠️ 动态导入 achievementService 失败:', e)
    );
  }
  
  // 如果传入了 word 参数，追踪该单词的发音点击次数（用于"念念不忘"勋章）
  if (word) {
    const clickCount = recordWordClick(word);
    if (clickCount > 0 && clickCount % 10 === 0) {
      import('./achievementService').then(({ checkUnforgettable }) => {
        const counts = getWordClickCounts();
        checkUnforgettable(counts).then((newlyUnlocked) => {
          if (newlyUnlocked.length > 0) {
            (global as any).__pendingUnlockBadges = newlyUnlocked;
          }
        }).catch((e: any) =>
          console.warn('   ⚠️ 检查念念不忘勋章失败:', e)
        );
      }).catch((e: any) =>
        console.warn('   ⚠️ 动态导入 achievementService 失败:', e)
      );
    }
  }
}

/**
 * 清理（"退出即停"）
 * 供组件的 useEffect cleanup 调用：
 *
 * useEffect(() => {
 *   return () => SoundManager.cleanup();
 * }, []);
 */
export function cleanup(): void {
  if (current) {
    console.log('[SoundManager] 清理音频资源');
    stopAll();
  }
}

/**
 * 是否正在播放
 */
export function isPlaying(): boolean {
  return current !== null;
}

/**
 * 获取当前播放内容摘要（调试用）
 */
export function getCurrentInfo(): string | null {
  if (!current) return null;
  if (current.source.type === 'tts') {
    return `TTS: "${current.source.text.substring(0, 30)}..."`;
  }
  return null;
}
