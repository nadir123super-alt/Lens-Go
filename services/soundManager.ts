/**
 * SoundManager — 全局音频播放管理器
 *
 * 职责：
 * 1. 全局跟踪当前正在播放的音频实例（TTS + expo-audio Player）
 * 2. "即点即停"：播放新音频前自动停止当前播放
 * 3. "退出即停"：提供 cleanup() 供 useEffect 卸载时调用
 * 4. 支持全局语速调节：读取 speechSettingsService 中的语速值
 *
 * TODO: 如需更高质量的 TTS 引擎（如 ElevenLabs），
 * 可在 playText() 中替换为 expo-audio 播放下载的音频文件。
 */
import * as Speech from 'expo-speech';
import { Platform } from 'react-native';
import { checkRepeaterAchievement } from './achievementService';
import { getSpeechRate } from './speechSettingsService';
import { cleanTextForSpeech } from './textCleaner';

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

// 发音播放完成计数器（用于"复读机"勋章）
// 本地缓冲计数：只在音频完整播放完毕时才加 1
let _audioPlayCompleteCount = 0;
export function getAudioPlayCompleteCount(): number {
  return _audioPlayCompleteCount;
}

// 页面级本地计数器（用于批量同步）
let _pageLocalCount = 0;
export function getPageLocalCount(): number {
  return _pageLocalCount;
}

// 重置页面本地计数器（页面加载时调用）
export function resetPageLocalCount(): void {
  _pageLocalCount = 0;
}

// 获取并重置页面本地计数器（页面卸载时调用，用于批量同步）
export function consumePageLocalCount(): number {
  const count = _pageLocalCount;
  _pageLocalCount = 0;
  return count;
}

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
  | { type: 'tts'; text: string }
  | { type: 'file'; uri: string };

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
 */
export function playText(text: string, onDone?: () => void, onProgress?: (progress: number) => void): void {
  // "即点即停"：先停止当前语音
  if (current) {
    stopAll();
  }

  // 注册新的播放
  current = { source: { type: 'tts', text } };

  // 使用 expo-speech 朗读
  // 此 API 无 pause/resume 需求，直接 speak
  const callback = onDone
    ? () => {
        onDone();
        // 如果当前就是本段语音，播完后清理引用
        if (current?.source.type === 'tts' && current.source.text === text) {
          current = null;
        }
      }
    : undefined;

  const cleanedText = cleanTextForSpeech(text);
  
  // 模拟进度回调（expo-speech 不提供进度，我们用定时器模拟）
  const totalLength = cleanedText.length;
  let currentProgress = 0;
  
  if (onProgress) {
    // 根据英语发音规则估算每个字符的发音时长
    // 考虑因素：元音 vs 辅音、音节位置、单词重音
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
    for (let i = 0; i < cleanedText.length; i++) {
      charDurations.push(getCharDuration(cleanedText[i], i, cleanedText));
    }
    
    // 计算总时长并调整语速
    const estimatedTotalDuration = charDurations.reduce((sum, dur) => sum + dur, 0);
    
    // 根据语速调整（0.9 是 speech rate，实际语速可能需要微调）
    // 额外调整因子以更好地匹配实际 TTS 速度
    const speedFactor = (1 / 0.9) * 0.95; // 稍微减慢模拟进度，更接近实际播放
    
    // 使用 setTimeout 链式调用，根据每个字符的估算时长依次更新进度
    const scheduleNext = (index: number) => {
      if (index >= cleanedText.length) {
        onProgress(cleanedText.length);
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

  // 在 TTS 播放前，确保音频会话已配置为最大音量输出
  ensureMaxVolumeBeforeSpeak().then(() => {
    // 从内存缓存中实时读取用户设定的语速
    const userRate = getSpeechRate();

    const ttsOptions: any = {
      language: 'en',
      rate: userRate,
      pitch: 1.0,
      volume: 1.0,
      onDone: () => {
        if (progressTimer) clearTimeout(progressTimer);
        // 确保最后更新到完整进度
        if (onProgress && currentProgress < totalLength) {
          onProgress(totalLength);
        }
        
        // 音频完整播放完毕，增加计数器（用于"复读机"勋章）
        _audioPlayCompleteCount++;
        _pageLocalCount++;
        
        // 每 10 次检查一次勋章解锁（避免频繁查询）
        if (_audioPlayCompleteCount % 10 === 0) {
          checkRepeaterAchievement(_audioPlayCompleteCount).then((newlyUnlocked) => {
            if (newlyUnlocked) {
              (global as any).__pendingUnlockBadges = ['repeater'];
            }
          }).catch((e: any) =>
            console.warn('   ⚠️ 检查复读机勋章失败:', e)
          );
        }
        
        if (callback) callback();
      },
      onError: () => {
        if (progressTimer) clearTimeout(progressTimer);
        console.warn('[SoundManager] TTS 播放出错:', cleanedText);
        current = null;
      },
    };

    // iOS: 使用独立音频会话，避免与录音模式冲突导致音量压低
    if (Platform.OS === 'ios') {
      ttsOptions.useApplicationAudioSession = false;
    }

    Speech.speak(cleanedText, ttsOptions);
  });
}

/**
 * 使用 expo-audio 播放本地音频文件
 * 如果当前有正在播放的音频，先停止再播放新的
 *
 * @param uri 音频文件 URI（file:// 或 asset://）
 * @returns 播放器实例（可外部调用 .stopAsync()），
 *          或 null（如果 expo-audio 不可用）
 */
export async function playFile(uri: string) {
  // "即点即停"：先停止当前语音
  if (current) {
    stopAll();
  }

  // 动态导入 expo-audio（避免启动时依赖）
  let AudioModule: any;
  try {
    AudioModule = (await import('expo-audio')).AudioModule;
  } catch {
    console.warn('[SoundManager] expo-audio 不可用，无法播放文件');
    return null;
  }

  // expo-audio 导出的是 AudioModule 命名空间，
  // 尝试通过 AudioModule.Player 或 createPlayer 创建播放器
  let player: any = null;

  try {
    // expo-audio 的 AudioModule 包含 Player 构造函数
    if (AudioModule.Player) {
      player = new AudioModule.Player();
    } else {
      // expo-audio 不暴露构造函数 → 直接退出
      console.warn('[SoundManager] expo-audio Player 不可用');
      return null;
    }
  } catch (err) {
    console.warn('[SoundManager] 创建播放器失败:', err);
    return null;
  }

  if (!player) return null;

  // 注册当前播放
  current = { source: { type: 'file', uri } };

  // 如果 player 有 playAsync / play 方法
  if (player.playAsync) {
    player.playAsync().catch((err: any) => {
      console.warn('[SoundManager] 文件播放失败:', err);
      if (current?.source.type === 'file' && current.source.uri === uri) {
        current = null;
      }
    });
  }

  // 注册完成回调（如果 player 支持）
  if (player.setOnPlaybackStatusUpdate) {
    player.setOnPlaybackStatusUpdate((status: any) => {
      if (status.didJustFinish) {
        if (current?.source.type === 'file' && current.source.uri === uri) {
          current = null;
        }
        // 自动卸载以释放资源
        player.unloadAsync?.().catch(() => {});
      }
    });
  }

  return player;
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
  return `File: ${current.source.uri.substring(0, 40)}...`;
}
