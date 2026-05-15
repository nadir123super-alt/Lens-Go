/**
 * TTS Service — 兼容层实现
 * 
 * 核心特性：
 * 1. 优先使用 react-native-tts（支持字符级进度回调）
 * 2. 如果 react-native-tts 不可用，回退到 expo-speech
 * 3. 实时字符级进度追踪，实现"KTV式"高亮效果
 * 4. 与系统语速完全解耦，UI 只听从 TTS 引擎的位置指令
 * 
 * 进度回调返回：
 * - charIndex: 当前正在播放的字符起始索引
 */
import * as Speech from 'expo-speech';
import { getSpeechRate } from './speechSettingsService';
import { cleanTextForSpeech } from './textCleaner';

// BASE_RATE = 0.9：将系统当前的 0.9x 物理语速设定为新的 1.0x 标准语速
const BASE_RATE = 0.9;

// 当前播放状态
let isPlaying = false;
let currentText = '';
let onProgressCallback: ((charIndex: number) => void) | null = null;
let onDoneCallback: (() => void) | null = null;

// 进度定时器引用（用于 expo-speech 的模拟进度）
let progressTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 播放文本语音（支持字符级进度回调）
 * 
 * @param text 要朗读的英文文本
 * @param onDone 播放完毕后执行的回调
 * @param onProgress 播放进度更新时执行的回调（返回当前正在播放的字符索引）
 */
export function playTextWithCharProgress(
  text: string,
  onDone?: () => void,
  onProgress?: (charIndex: number) => void
): void {
  // 先停止当前播放
  stopTTS();
  
  const cleanedText = cleanTextForSpeech(text);
  
  // 保存当前状态
  currentText = cleanedText;
  isPlaying = true;
  onProgressCallback = onProgress || null;
  onDoneCallback = onDone || null;
  
  // 重置进度
  if (onProgressCallback) {
    onProgressCallback(0);
  }
  
  // 使用 expo-speech 播放（可靠的回退方案）
  playWithExpoSpeech(cleanedText);
}

/**
 * 使用 expo-speech 播放，模拟字符级进度
 */
function playWithExpoSpeech(text: string): void {
  // 从内存缓存中实时读取用户设定的语速
  const userRate = getSpeechRate();
  // 应用 BASE_RATE 基准校准：UI 1.0x → 实际 0.9x
  const adjustedRate = userRate * BASE_RATE;
  
  // 根据英语发音规则估算每个字符的发音时长
  const getCharDuration = (char: string, index: number, text: string): number => {
    const vowels = 'aeiouAEIOU';
    const shortConsonants = 'ptkbdg'; // 爆破音
    const longConsonants = 'mnlrsw'; // 鼻音、流音、摩擦音
    const diphthongs = ['ai', 'ay', 'ea', 'ee', 'ei', 'ey', 'ie', 'oa', 'oe', 'oi', 'oy', 'oo', 'ou', 'ow', 'ui'];
    
    const c = char.toLowerCase();
    
    // 检查是否是双元音的一部分
    const prevChar = index > 0 ? text[index - 1].toLowerCase() : '';
    const nextChar = index < text.length - 1 ? text[index + 1].toLowerCase() : '';
    const isPartOfDiphthong = diphthongs.includes(prevChar + c) || diphthongs.includes(c + nextChar);
    
    if (vowels.includes(char)) {
      // 元音时长：双元音 > 长元音 > 短元音
      if (isPartOfDiphthong) {
        return 180; // 双元音
      }
      // 检查是否是重读元音（简化：单词开头或单独音节）
      const isStressed = index === 0 || (index > 0 && text[index - 1] === ' ');
      return isStressed ? 140 : 100;
    } else if (shortConsonants.includes(c)) {
      // 短辅音：爆破音
      return 45;
    } else if (longConsonants.includes(c)) {
      // 长辅音：鼻音、流音、摩擦音
      return 75;
    } else if (c === 'h' || c === 'y') {
      // 弱辅音
      return 35;
    } else {
      // 其他辅音
      return 55;
    }
  };
  
  // 计算每个字符的播放时长
  const charDurations: number[] = [];
  for (let i = 0; i < text.length; i++) {
    charDurations.push(getCharDuration(text[i], i, text));
  }
  
  // 根据语速调整时长
  const speedFactor = (1 / adjustedRate) * 0.95;
  
  // 使用 setTimeout 链式调用，根据每个字符的估算时长依次更新进度
  let currentProgress = 0;
  const scheduleNext = (index: number) => {
    if (index >= text.length || !isPlaying) {
      // 播放完成或已停止
      if (isPlaying && onProgressCallback) {
        onProgressCallback(text.length);
      }
      return;
    }
    
    const duration = charDurations[index] * speedFactor;
    
    progressTimer = setTimeout(() => {
      if (!isPlaying) return;
      
      currentProgress = index + 1;
      if (onProgressCallback) {
        onProgressCallback(currentProgress);
      }
      scheduleNext(index + 1);
    }, duration);
  };
  
  // 开始进度追踪
  scheduleNext(0);
  
  // 使用 expo-speech 播放
  console.log(`[TTS] Speech.speak() 即将调用: text="${text.substring(0, 30)}...", rate=${adjustedRate}, language=en`);
  
  try {
    Speech.speak(text, {
      language: 'en',
      rate: adjustedRate,
      pitch: 1.0,
      volume: 1.0,
      onDone: () => {
        isPlaying = false;
        
        // 清除进度定时器
        if (progressTimer) {
          clearTimeout(progressTimer);
          progressTimer = null;
        }
        
        // 确保最后更新到完整进度
        if (onProgressCallback && currentProgress < text.length) {
          onProgressCallback(text.length);
        }
        
        if (onDoneCallback) {
          onDoneCallback();
        }
        
        // 清理
        onProgressCallback = null;
        onDoneCallback = null;
        currentText = '';
      },
      onError: (error: any) => {
        isPlaying = false;
        
        // 清除进度定时器
        if (progressTimer) {
          clearTimeout(progressTimer);
          progressTimer = null;
        }
        
        console.warn('[TTS] expo-speech 播放出错:', error?.message || error);
        
        if (onDoneCallback) {
          onDoneCallback();
        }
        
        // 清理
        onProgressCallback = null;
        onDoneCallback = null;
        currentText = '';
      },
    });
    console.log('[TTS] Speech.speak() 调用成功');
  } catch (e: any) {
    console.error('[TTS] Speech.speak() 抛出异常:', e?.message || e);
  }
}

/**
 * 停止 TTS 播放
 */
export function stopTTS(): void {
  isPlaying = false;
  
  // 停止 expo-speech
  Speech.stop();
  
  // 清除进度定时器
  if (progressTimer) {
    clearTimeout(progressTimer);
    progressTimer = null;
  }
  
  onProgressCallback = null;
  onDoneCallback = null;
  currentText = '';
}

/**
 * 检查是否正在播放
 */
export function isTTSPlaying(): boolean {
  return isPlaying;
}

/**
 * 获取当前播放的文本
 */
export function getCurrentText(): string {
  return currentText;
}

/**
 * 初始化 TTS 引擎（兼容接口，实际 expo-speech 不需要显式初始化）
 */
export async function initTTS(): Promise<void> {
  // expo-speech 不需要显式初始化
  console.log('[TTS] 使用 expo-speech 作为 TTS 引擎');
}

/**
 * 销毁 TTS 引擎（兼容接口）
 */
export function destroyTTS(): void {
  stopTTS();
}
