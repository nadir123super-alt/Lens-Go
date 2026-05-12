/**
 * 语音录制服务 - 口语练习
 * 使用 expo-av (Audio.Recording) 实现录音功能
 *
 * 安全模式配置 (Safe Config) — Android 高兼容性：
 *   - Android: 3GP/AMR_NB — 8kHz, mono
 *     · extension: .3gp, sampleRate: 8000, encoder: AMR_NB, outputFormat: THREE_GPP
 *     · 原因：.wav LINEARPCM 在很多 Android 版本上会导致崩溃/自动停止
 *   - iOS: LINEARPCM WAV — 16kHz, 16bit, mono
 *     · extension: .wav, sampleRate: 16000
 *
 * 编码同步 (Encoding Sync)：
 *   Android: encoding='amr', sampleRate=8000
 *   iOS:     encoding='raw', sampleRate=16000
 *   供 iflytekService/xfiseClient 读取
 */

import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import { getInfoAsync } from 'expo-file-system/legacy';
import { NativeModules, Platform } from 'react-native';

// 音量阈值（dBFS）：低于此值视为"未检测到有效声音"
// 从 -55 进一步降低到 -65，让系统对极微弱声音也更敏感
// 同时配合 metering 归一化逻辑，确保 whisper 级别的音量也能触发
export const VOLUME_THRESHOLD_DB = -65;

// ====== 强制扬声器输出 ======

/**
 * 强制音频路由到主扬声器（而非听筒/听筒）
 * - iOS: 通过 Audio.setAudioModeAsync 的 defaultToSpeaker 选项
 * - Android: 通过 NativeModules 调用 AudioManager.setSpeakerphoneOn(true)
 *
 * 在 App 初始化、进入口语模块、录音开始前调用此函数。
 */
export async function forceSpeakerOutput(): Promise<void> {
  try {
    // iOS: 通过 Audio.setAudioModeAsync 设置 defaultToSpeaker
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: false,
      defaultToSpeaker: true,
      interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
      interruptionModeIOS: InterruptionModeIOS.DoNotMix,
      playThroughEarpieceAndroid: false,
    } as any);
    console.log('[forceSpeakerOutput] ✅ Audio.setAudioModeAsync (Speaker)');
  } catch (e: any) {
    console.warn('[forceSpeakerOutput] ⚠️ setAudioModeAsync 失败:', e?.message);
  }

  // Android: 尝试通过 NativeModules 强制 setSpeakerphoneOn(true)
  if (Platform.OS === 'android') {
    try {
      const AudioManager = (NativeModules as any).AudioManager;
      if (AudioManager?.setSpeakerphoneOn) {
        await AudioManager.setSpeakerphoneOn(true);
        console.log('[forceSpeakerOutput] ✅ Android Native: setSpeakerphoneOn(true)');
      } else {
        console.log('[forceSpeakerOutput] ℹ️ Android Native: AudioManager.setSpeakerphoneOn 不可用，依赖 expo-av 配置');
      }
    } catch (e: any) {
      console.warn('[forceSpeakerOutput] ⚠️ Android Native setSpeakerphoneOn 失败:', e?.message);
    }
  }
}

/**
 * 注册音频会话强化器到 SoundManager。
 * 这样每次 TTS 播放前都会自动调用 forceSpeakerOutput() 确保最大音量。
 */
export function initAudioEnhancements(): void {
  try {
    // 动态导入 SoundManager 并注册强化器
    const soundManager = require('./soundManager');
    if (soundManager.setAudioSessionEnsurer) {
      soundManager.setAudioSessionEnsurer(async () => {
        await forceSpeakerOutput();
      });
      console.log('[AudioEnhance] ✅ 已注册 TTS 播放前音频强化器 (forceSpeakerOutput)');
    }
  } catch (e: any) {
    console.warn('[AudioEnhance] ⚠️ 注册音频强化器失败:', e?.message);
  }
}

/**
 * 打印当前音频路由状态（调试用）
 */
export function logAudioRouteStatus(): void {
  if (Platform.OS === 'android') {
    try {
      const AudioManager = (NativeModules as any).AudioManager;
      if (AudioManager?.getAudioRoute) {
        AudioManager.getAudioRoute().then((route: string) => {
          console.log(`[AudioRoute] 📢 Android 音频路由: ${route}`);
        }).catch(() => {
          console.log('[AudioRoute] ℹ️ 无法获取 Android 音频路由');
        });
      } else {
        console.log('[AudioRoute] ℹ️ Android AudioManager.getAudioRoute 不可用');
      }
    } catch {
      console.log('[AudioRoute] ℹ️ 无法获取 Android 音频路由');
    }
  } else {
    // iOS: 通过 AVAudioSession 日志确认
    console.log('[AudioRoute] 📢 iOS: 已设置 defaultToSpeaker=true，音频应走主扬声器');
  }
}

/** 最短录音时长（毫秒）：低于此值视为快速点击 */
export const MIN_RECORDING_DURATION_MS = 500;

/**
 * 录音前预留空白期（毫秒）：在录音开始后预留一段空白，
 * 避免切掉用户说话的第一个音节。
 * 录音对象创建后，前 100ms 的数据会被丢弃或忽略。
 */
export const LEAD_IN_SILENCE_MS = 100;

// ====== 状态变量 ======
let recorder: Audio.Recording | null = null;
let onMeteringCallback: ((value: number) => void) | null = null;

let _maxVolume: number = -160;
let _currentMetering: number = -160;
let _startTimestamp: number = 0;
let _meteringTimer: ReturnType<typeof setInterval> | null = null;
let _autoStopTimer: ReturnType<typeof setTimeout> | null = null;
let _onAutoStopCallback: (() => void) | null = null;
/** 标记当前是否正在执行有意的 stop 操作，抑制 onRecordingStatusUpdate 的误报 */
let _intentionalStop = false;

// ====== 音量追踪 ======

export function setVolumeMeteringCallback(cb: (value: number) => void): void {
  onMeteringCallback = cb;
}

export function getCurrentMetering(): number {
  return _currentMetering;
}

export function getMaxVolume(): number {
  return _maxVolume;
}

export function resetVolumeTracking(): void {
  _maxVolume = -160;
  _currentMetering = -160;
}

export function stopVolumeMetering(): void {
  if (_meteringTimer) {
    clearInterval(_meteringTimer);
    _meteringTimer = null;
  }
  onMeteringCallback = null;
}

// ====== 权限 ======

export async function requestAudioPermission(): Promise<boolean> {
  try {
    const { status } = await Audio.requestPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
}

export async function checkAudioPermission(): Promise<boolean> {
  try {
    const { status } = await Audio.getPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
}

// ====== 安全停止 ======

/** 内部：安全的 stopAndUnload，确保 finally 中置空 recorder */
async function internalStopAndUnload(): Promise<void> {
  const savedRecorder = recorder;
  if (!savedRecorder) return;

  try {
    // 检查录音对象是否活跃
    let shouldStop = false;
    try {
      const st = await savedRecorder.getStatusAsync();
      const canRecord = (st as any).canRecord;
      if (st.isRecording === true || canRecord === true) {
        shouldStop = true;
      } else {
        console.log('[recordingService] ℹ️ 录音对象未处于活跃状态，跳过 stopAndUnloadAsync');
      }
    } catch {
      console.log('[recordingService] ℹ️ 录音对象已不可用（getStatusAsync 异常），跳过 stopAndUnloadAsync');
    }

    if (shouldStop) {
      await savedRecorder.stopAndUnloadAsync();
      console.log('[recordingService] ✅ stopAndUnloadAsync 完成');
    }
  } catch (err: any) {
    console.warn('[recordingService] ⚠️ stopAndUnloadAsync() 异常（可忽略）:', err?.message);
  } finally {
    // ★ 关键：finally 块中彻底释放硬件资源引用
    recorder = null;
  }
}

async function safeStopAndUnload(): Promise<void> {
  if (_meteringTimer) {
    clearInterval(_meteringTimer);
    _meteringTimer = null;
  }
  if (_autoStopTimer) {
    clearTimeout(_autoStopTimer);
    _autoStopTimer = null;
  }
  await internalStopAndUnload();
}

// ====== prepareToRecord — 重新初始化录音对象（用于权限恢复） ======

/**
 * 准备工作：重新创建录音实例
 * 在 canRecord 为 false 时调用，避免复用已崩溃的对象
 */
export async function prepareToRecord(): Promise<void> {
  // 先清理残余
  await safeStopAndUnload();
  resetVolumeTracking();

  // 重新设置音频模式
  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: false,
      defaultToSpeaker: true,
      interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
      interruptionModeIOS: InterruptionModeIOS.DoNotMix,
      playThroughEarpieceAndroid: false,
    } as any);
    console.log('[recordingService] ✅ Audio.setAudioModeAsync 已设置 (prepareToRecord) [Speaker+NoDuck]');
  } catch (e: any) {
    console.warn('[recordingService] ⚠️ setAudioModeAsync 失败 (prepareToRecord):', e?.message);
  }

  console.log('[recordingService] 🔄 录音对象已重新初始化');
}

// ====== 录音选项 ======

// ====== 音频编码常量 ======
// Android 使用 AMR_NB (8kHz) — 兼容性最佳
// 讯飞 ISE API 原生支持 aue=amr
// 参考: https://www.xfyun.cn/doc/Ise/Ise-API.html
//
// 编码同步 (Encoding Sync)：
//   Android AMR_NB → 讯飞 encoding='amr', sample_rate=8000
//   iOS LINEARPCM  → 讯飞 encoding='raw',  sample_rate=16000

export const AUDIO_ENCODING_ANDROID = 'amr-nb';  // AV 编码器参数
export const AUDIO_ISE_ENCODING_ANDROID = 'amr';  // 讯飞 API 兼容名称
export const AUDIO_SAMPLE_RATE_ANDROID = 8000;
export const AUDIO_FORMAT_ANDROID = 'audio/L16;rate=8000';

export const AUDIO_ENCODING_IOS = 'raw';
export const AUDIO_ISE_ENCODING_IOS = 'raw';
export const AUDIO_SAMPLE_RATE_IOS = 16000;
export const AUDIO_FORMAT_IOS = 'audio/L16;rate=16000';

/**
 * 录音配置
 */
const RECORDING_OPTIONS: Audio.RecordingOptions = {
  android: {
    extension: '.3gp',
    sampleRate: 8000,
    numberOfChannels: 1,
    outputFormat: Audio.AndroidOutputFormat.THREE_GPP,
    audioEncoder: Audio.AndroidAudioEncoder.AMR_NB,
  },
  isMeteringEnabled: true,
  ios: {
    extension: '.wav',
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 256000,
    outputFormat: Audio.IOSOutputFormat.LINEARPCM,
    audioQuality: Audio.IOSAudioQuality.MAX,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: 'audio/3gpp',
    bitsPerSecond: 128000,
  },
};

/**
 * 获取当前平台的音频编码信息（用于 ISE API 通信）
 * 
 * 注意：encoding 返回的是 ISE API 兼容的名称（amr / raw），
 * 而非 expo-av 编码器名称（amr-nb）。因为 ISE API 的 encoding 
 * 字段要求 "amr" 而非 "amr-nb"。
 */
export function getCurrentAudioEncoding(): {
  encoding: string;
  sampleRate: number;
  format: string;
  extension: string;
} {
  if (Platform.OS === 'android') {
    return {
      encoding: AUDIO_ISE_ENCODING_ANDROID,  // "amr" — ISE API 兼容名称
      sampleRate: AUDIO_SAMPLE_RATE_ANDROID,
      format: AUDIO_FORMAT_ANDROID,
      extension: '.3gp',
    };
  }
  return {
    encoding: AUDIO_ISE_ENCODING_IOS,  // "raw" — ISE API 兼容
    sampleRate: AUDIO_SAMPLE_RATE_IOS,
    format: AUDIO_FORMAT_IOS,
    extension: '.wav',
  };
}

// ====== 公开方法 ======

/**
 * 开始录音
 */
export async function startRecording(): Promise<void> {
  // 0. 防御性清理
  if (recorder) {
    console.log('[recordingService] 🔄 检测到旧录音实例，强制清理后再启动');
    await safeStopAndUnload();
    if (Platform.OS === 'android') {
      console.log('[recordingService] ⏳ Android 延时 100ms，等待系统释放音频资源');
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  resetVolumeTracking();
  _startTimestamp = Date.now();
  _intentionalStop = false;

  // 1. 显式请求录音权限
  const { status } = await Audio.requestPermissionsAsync();
  if (status !== 'granted') {
    console.warn('[recordingService] ❌ 未获得录音权限');
    throw new Error('录音权限未授予');
  }

  // 2. 设置音频模式
  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: false,
      defaultToSpeaker: true,
      interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
      interruptionModeIOS: InterruptionModeIOS.DoNotMix,
      playThroughEarpieceAndroid: false,
    } as any);
    console.log('[recordingService] ✅ Audio.setAudioModeAsync 已设置 [Speaker+NoDuck]');
  } catch (e: any) {
    console.warn('[recordingService] ⚠️ setAudioModeAsync 失败:', e?.message);
  }

  // 3. 检查 canRecord
  if (recorder) {
    try {
      const statusCheck = await recorder.getStatusAsync();
      const canRecord = (statusCheck as any).canRecord;
      if (canRecord === false || canRecord === undefined) {
        console.warn(`[recordingService] ⚠️ canRecord=${canRecord}，重新初始化录音对象`);
        await prepareToRecord();
      } else {
        console.log(`[recordingService] ✓ canRecord=${canRecord}，可以复用现有录音对象`);
      }
    } catch {
      console.warn('[recordingService] ⚠️ 录音对象已崩溃，重新初始化');
      await prepareToRecord();
    }
  } else {
    console.log('[recordingService] 📌 无现有录音对象，执行 prepareToRecord');
    await prepareToRecord();
  }

  // 4. 强制停止 TTS 朗读
  try {
    const { stopAll: stopAllSound } = await import('./soundManager');
    stopAllSound();
  } catch {}

  // 5. 创建并启动录音
  try {
    const { recording } = await Audio.Recording.createAsync(RECORDING_OPTIONS);
    recorder = recording;

    // 异步等待就绪
    try {
      await new Promise<void>((resolveReady) => {
        let attempts = 0;
        const maxAttempts = 20;
        const checkReady = () => {
          attempts++;
          if (!recorder) {
            resolveReady();
            return;
          }
          try {
            recorder.getStatusAsync().then((st) => {
              if (st.isRecording) {
                console.log(`[recordingService] ✅ 录音对象就绪，已开始录制 (检查次数=${attempts})`);
                resolveReady();
              } else if (attempts >= maxAttempts) {
                console.warn(`[recordingService] ⚠️ 录音对象未在 ${maxAttempts * 100}ms 内变为 recording 状态`);
                resolveReady();
              } else {
                setTimeout(checkReady, 100);
              }
            }).catch(() => {
              if (attempts >= maxAttempts) {
                resolveReady();
              } else {
                setTimeout(checkReady, 100);
              }
            });
          } catch {
            if (attempts >= maxAttempts) {
              resolveReady();
            } else {
              setTimeout(checkReady, 100);
            }
          }
        };
        checkReady();
      });
    } catch (readyErr: any) {
      console.warn('[recordingService] ⚠️ 就绪等待异常:', readyErr?.message);
    }

    // ★ 预留空白期：录音就绪后等待 100ms，避免切掉用户说话的第一个音节
    // 这段时间 metering 尚未启动，UI 层也刚进入 recording 状态
    await new Promise((r) => setTimeout(r, LEAD_IN_SILENCE_MS));

    // 监听录音状态变化，捕获自动停止（仅当不是有意停止时）
    recording.setOnRecordingStatusUpdate((recordingStatus) => {
      if (_intentionalStop) {
        // 有意停止，不打印警告
        return;
      }
      if (!recordingStatus.isRecording && recordingStatus.isDoneRecording) {
        const elapsed = Date.now() - _startTimestamp;
        console.warn(`[recordingService] ⚠️ 录音意外停止！已录制 ${elapsed}ms`);

        if (elapsed < 1000) {
          console.error(`[recordingService] ❌ 录音在 1 秒内自动停止 (${elapsed}ms)，可能原因：`);
          console.error(`[recordingService]    1. Android 音频编码/格式不兼容`);
          console.error(`[recordingService]    2. 麦克风被其他应用占用`);
          console.error(`[recordingService]    3. AudioMode 设置不当`);
          console.error(`[recordingService] 完整 status:`, JSON.stringify(recordingStatus));
          if ((recordingStatus as any).error) {
            console.error(`[recordingService] ❌ status.error 详情:`, JSON.stringify((recordingStatus as any).error));
          }
          if ((recordingStatus as any).nativeError) {
            console.error(`[recordingService] ❌ nativeError:`, (recordingStatus as any).nativeError);
          }
        }

        console.warn('[recordingService] status:', JSON.stringify(recordingStatus));
      }
    });

    const { encoding, sampleRate } = getCurrentAudioEncoding();
    console.log(`[recordingService] ✅ 录音已启动 (expo-av / encoding=${encoding}, sampleRate=${sampleRate} | ${Platform.OS})`);
  } catch (startErr: any) {
    console.error('[recordingService] ❌ Recording.createAsync 失败:', startErr?.message);
    console.error('[recordingService] ❌ 完整错误:', JSON.stringify(startErr));
    recorder = null;
    throw new Error(`录音启动失败: ${startErr?.message || '未知错误'}`);
  }

  // 6. 自动停止安全阀：15秒后强制结束（从10秒延长，给用户更多思考和喘气时间）
  _autoStopTimer = setTimeout(async () => {
    console.warn('[recordingService] ⏰ 录音超过 15 秒，自动停止安全阀触发');
    if (_onAutoStopCallback) {
      _onAutoStopCallback();
    } else {
      await stopRecordingWithVolume();
    }
  }, 15000);

  // 7. metering 轮询（每 100ms 采样一次，比之前 200ms 更密集）
  _meteringTimer = setInterval(async () => {
    if (!recorder) return;
    try {
      const recStatus = await recorder.getStatusAsync();
      if (recStatus.isRecording) {
        const metering = (recStatus as any).metering ?? -160;
        _currentMetering = metering;
        if (metering > _maxVolume) _maxVolume = metering;

        // 每 500ms 输出一次音量分贝值（每 5 次采样输出一次）
        if (Math.random() < 0.2) {
          console.log(`[recordingService] 📊 Input Level: ${metering.toFixed(1)} dBFS (peak: ${_maxVolume.toFixed(1)} dBFS)`);
        }

        // 传递原始 metering 值给回调，让 UI 层自行归一化
        onMeteringCallback?.(metering);
      } else if (!recStatus.isRecording && recStatus.isDoneRecording) {
        if (_intentionalStop) return; // 有意停止，不警告
        console.warn('[recordingService] ⚠️ metering 线程检测到录音已自动停止！');
        if ((recStatus as any).error) {
          console.error('[recordingService] ❌ 自动停止 error:', JSON.stringify((recStatus as any).error));
        }
      }
    } catch {}
  }, 100);
}

// ====== 设置自动停止回调 ======

export function setAutoStopCallback(cb: (() => void) | null): void {
  _onAutoStopCallback = cb;
}

export function evaluateRecording(_originalText: string, _userText?: string): {
  score: number;
  level: string;
  feedback: string;
} {
  return {
    score: 0,
    level: '--',
    feedback: '录音完成，请使用口语练习页面进行 AI 评测',
  };
}

export async function forceStopRecording(): Promise<void> {
  await safeStopAndUnload();
  resetVolumeTracking();
}

export async function stopRecording(): Promise<string | null> {
  // 标记有意停止，抑制 onRecordingStatusUpdate 的"意外停止"误报
  _intentionalStop = true;

  if (_autoStopTimer) {
    clearTimeout(_autoStopTimer);
    _autoStopTimer = null;
  }
  if (!recorder) return null;

  // 最小录音时长保护
  const elapsed = Date.now() - _startTimestamp;
  if (elapsed < MIN_RECORDING_DURATION_MS) {
    console.warn(
      `[recordingService] ⚠️ 录音仅 ${elapsed}ms < ${MIN_RECORDING_DURATION_MS}ms 最小时长，延迟停止以保护缓冲区`
    );
    await new Promise((r) => setTimeout(r, MIN_RECORDING_DURATION_MS - elapsed + 50));
  }

  const savedRecorder = recorder;

  try {
    let uri: string | null = null;
    try {
      uri = savedRecorder.getURI();
      console.log(`[recordingService] 📁 停止前获取 URI: ${uri}`);
    } catch {
      console.warn('[recordingService] ⚠️ 停止前 getURI() 失败');
    }

    let shouldStop = false;
    try {
      const st = await savedRecorder.getStatusAsync();
      const canRecord = (st as any).canRecord;
      if (st.isRecording === true || canRecord === true) {
        shouldStop = true;
        console.log(`[recordingService] ℹ️ 录音对象活跃 (isRecording=${st.isRecording}, canRecord=${canRecord})，执行停止`);
      } else {
        console.log(`[recordingService] ℹ️ 录音对象未活跃 (isRecording=${st.isRecording}, canRecord=${canRecord})，跳过 stopAndUnloadAsync`);
      }
    } catch {
      console.log('[recordingService] ℹ️ 录音对象已不可用（getStatusAsync 异常），跳过 stopAndUnloadAsync');
    }

    if (shouldStop) {
      await savedRecorder.stopAndUnloadAsync();
      console.log(`[recordingService] ✅ stopAndUnloadAsync 完成`);
    }

    console.log(`[recordingService] ⏹ 录音停止 | URI: ${uri}`);
    return uri;
  } catch (error) {
    console.error('[recordingService] 停止录音失败:', error);
    return null;
  } finally {
    // ★ 关键：finally 中释放硬件资源引用，即使 stopAndUnloadAsync 抛异常也不会泄漏
    recorder = null;
    if (_meteringTimer) {
      clearInterval(_meteringTimer);
      _meteringTimer = null;
    }
  }
}

export async function stopRecordingWithVolume(): Promise<{
  uri: string | null;
  maxVolume: number;
  tooShort: boolean;
}> {
  const duration = Date.now() - _startTimestamp;
  let volume = _maxVolume;

  if (duration < MIN_RECORDING_DURATION_MS) {
    console.warn(
      `[recordingService] ⚠️ 录音太短 (${duration}ms < ${MIN_RECORDING_DURATION_MS}ms)，静默清理`
    );
    await safeStopAndUnload();
    return { uri: null, maxVolume: volume, tooShort: true };
  }

  const uri = await stopRecording();

  let fileSize = 0;
  let fileExists = false;
  if (uri) {
    try {
      const info: any = await getInfoAsync(uri as any, { size: true } as any);
      fileExists = info.exists;
      fileSize = info.size ?? 0;
    } catch (e: any) {
      console.warn(`[recordingService] ⚠️ 无法获取文件信息: ${e?.message}`);
    }
  }

  // ★ 激进放行逻辑：只要文件存在且有数据（> 0 bytes），就放行评分
  // 因为某些 Android 设备上 expo-av metering 可能完全不准确，
  // 用户明明说话了但 dBFS 值始终为 -160（未触发）
  // 而文件确实录到了声音
  if (volume <= -159 && fileSize > 0) {
    console.warn(`[recordingService] ⚠️ metering 未触发但文件有效 (${fileSize} bytes)，放行并设置默认音量`);
    volume = -20;
  }

  // 即使 metering 很低但文件有一定大小，也降低阈值判断
  // ★ 进一步降低文件大小门槛：从 1024 降到 512 bytes
  // AMR 编码下 512 bytes ≈ 320ms 音频，足够包含一个单词的发音
  if (volume < VOLUME_THRESHOLD_DB && volume > -159 && fileSize > 512) {
    console.warn(`[recordingService] ⚠️ metering=${volume.toFixed(1)}dBFS 低于阈值但文件有效 (${fileSize} bytes)，提升音量值`);
    volume = Math.max(volume, -40);
  }

  // ★ 诊断：检查文件有效性（3GP 文件最小约 400 bytes，AMR 数据至少几十 bytes）
  if (fileExists && fileSize > 0 && fileSize < 200) {
    console.warn(`[recordingService] ⚠️ 文件存在但非常小 (${fileSize} bytes)，可能只有 3GP 容器头无音频数据`);
  }

  console.log(
    `[recordingService] 录音结束 | 时长: ${duration}ms | 最大音量: ${volume.toFixed(1)} dBFS | ` +
    `文件: ${uri || '(null)'} | 存在: ${fileExists} | 大小: ${fileSize} bytes`
  );

  return { uri, maxVolume: volume, tooShort: false };
}
