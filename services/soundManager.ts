/**
 * SoundManager — 全局音频播放管理器
 *
 * 职责：
 * 1. "即点即停"：播放新音频前自动停止当前播放
 * 2. "退出即停"：提供 cleanup() 供 useEffect 卸载时调用
 * 3. 自动回调：播放结束后调用 onDone，可用于重置状态
 *
 * 供【拍照识别】、【普通口语练习】、【AI实时通话】三个模块统一调用
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
const BASE_RATE = 0.9;

// ====== 音频会话强化 ======
let _ensureAudioSession: (() => Promise<void>) | null = null;

export function setAudioSessionEnsurer(fn: () => Promise<void>): void {
  _ensureAudioSession = fn;
}

async function ensureMaxVolumeBeforeSpeak(): Promise<void> {
  if (_ensureAudioSession) {
    try {
      await _ensureAudioSession();
    } catch {
      // 静默失败
    }
  }
}

// ====== 全局状态 ======
let currentState: {
  source: string | null;
} = {
  source: null,
};

// ====== 停止所有播放 ======
export function stopAll(): void {
  console.log('[SoundManager] stopAll()');
  Speech.stop();
  currentState.source = null;
}

// ====== 进度追踪（模拟字符级进度） ======
let progressTimer: ReturnType<typeof setTimeout> | null = null;

function startProgressTracking(
  text: string,
  onProgress?: (progress: number) => void,
): void {
  if (!onProgress) return;

  const totalLength = text.length;
  const estimatedDuration = totalLength * 100; // 估算时长
  const interval = 50; // 50ms 更新一次
  
  let elapsed = 0;
  
  progressTimer = setInterval(() => {
    elapsed += interval;
    const progress = Math.min((elapsed / estimatedDuration) * totalLength, totalLength);
    onProgress(Math.floor(progress));
    
    if (elapsed >= estimatedDuration) {
      if (progressTimer) {
        clearInterval(progressTimer);
        progressTimer = null;
      }
      onProgress(totalLength);
    }
  }, interval) as unknown as ReturnType<typeof setTimeout>;
}

// ====== 主播放函数 ======
export async function playText(
  text: string,
  onDone?: () => void,
  onProgress?: (progress: number) => void,
  word?: string
): Promise<void> {
  console.log(`[SoundManager] playText() 被调用: "${text.substring(0, 50)}..."`);

  // "即点即停"：先停止当前播放
  if (currentState.source) {
    console.log('[SoundManager] 停止当前播放');
    stopAll();
  }

  const cleanedText = cleanTextForSpeech(text);
  if (!cleanedText || cleanedText.trim().length === 0) {
    console.warn('[SoundManager] 文本为空，跳过播放');
    return;
  }

  console.log('[SoundManager] ===== 使用 expo-speech =====');
  currentState.source = cleanedText;
  
  const callback = onDone
    ? () => {
        trackAchievements(word);
        onDone();
        if (currentState?.source === cleanedText) {
          currentState.source = null;
        }
      }
    : undefined;

  const totalLength = cleanedText.length;
  
  // 模拟字符级进度
  if (onProgress) {
    startProgressTracking(cleanedText, onProgress);
  }

  ensureMaxVolumeBeforeSpeak().then(() => {
    const userRate = getSpeechRate();
    const adjustedRate = userRate * BASE_RATE;

    const ttsOptions: any = {
      language: 'en',
      rate: adjustedRate,
      pitch: 1.0,
      volume: 1.0,
      onDone: () => {
        console.log('[SoundManager] expo-speech 播放完成');
        if (progressTimer) {
          clearInterval(progressTimer);
          progressTimer = null;
        }
        if (onProgress) {
          onProgress(totalLength);
        }
        callback?.();
      },
      onError: (error: any) => {
        console.warn('[SoundManager] expo-speech 播放出错:', error?.message || error);
        if (progressTimer) {
          clearInterval(progressTimer);
          progressTimer = null;
        }
        currentState.source = null;
      },
    };

    if (Platform.OS === 'ios') {
      ttsOptions.useApplicationAudioSession = false;
    }

    Speech.speak(cleanedText, ttsOptions);
  });
}

// ====== 成就追踪 ======
async function trackAchievements(word?: string): Promise<void> {
  incrementAudioPlayCompleteCount();
  incrementPageLocalCount();
  
  const currentCount = getAudioPlayCompleteCount();
  
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

// ====== 清理 ======
export function cleanup(): void {
  if (currentState.source) {
    console.log('[SoundManager] 清理音频资源');
    stopAll();
  }
}

// ====== 是否正在播放 ======
export function isPlaying(): boolean {
  return currentState.source !== null;
}

// ====== 获取当前播放信息 ======
export function getCurrentInfo(): string | null {
  if (!currentState.source) return null;
  return `expo-speech: "${currentState.source.substring(0, 30)}..."`;
}
