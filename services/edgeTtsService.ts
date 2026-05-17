/**
 * Edge TTS 服务 v5 - 基于 Supabase Edge Functions
 *
 * 核心特性：
 * 1. 完美兼容 Expo Go - 只需要 HTTP 请求
 * 2. 神经网络音色 - 地道 native speaker 发音
 * 3. 精细参数控制 - 语速、音调
 * 4. 中英文分离 - 各自使用最佳音色
 * 5. 无冷启动 - Serverless 函数，即开即用
 *
 * 音色配置：
 * - 中文: zh-CN-XiaoxiaoNeural（晓晓，活泼女声）
 * - 英文: en-US-EmmaMultilingualNeural（Emma，多语言神经网络）
 */

import { Audio } from 'expo-av';

// ================= 配置 =================
// 部署 Supabase Edge Function 后，请替换为你的实际 API URL！
// 格式: https://YOUR_PROJECT_REF.supabase.co/functions/v1/tts
const TTS_API_URL = 'https://cqpszvmritgldvzhlbds.supabase.co/functions/v1/tts'; // 请修改这里！

interface TtsOptions {
  text: string;
  language?: 'en' | 'zh';
  emotion?: 'normal' | 'excited' | 'questioning' | 'cheerful';
  onStart?: () => void;
  onDone?: () => void;
  onError?: (error: any) => void;
  onProgress?: (charIndex: number) => void;
}

interface TtsVoice {
  name: string;
  voice: string;
  language: string;
}

const VOICES: Record<string, string> = {
  zh: 'zh-CN-XiaoxiaoNeural',
  en: 'en-US-EmmaMultilingualNeural',
};

class EdgeTtsService {
  private sound: Audio.Sound | null = null;
  private isPlaying = false;
  private currentText = '';
  private onDoneCallback: (() => void) | null = null;
  private onProgressCallback: ((charIndex: number) => void) | null = null;
  private progressInterval: ReturnType<typeof setInterval> | null = null;
  private voices: TtsVoice[] = [];
  private audioCache: Map<string, string> = new Map(); // 音频缓存

  async init(): Promise<void> {
    console.log('[EdgeTtsService] 初始化完成');
  }

  /**
   * 预加载音频到缓存（后台静默加载）
   */
  async preload(text: string, language: 'en' | 'zh' = 'en'): Promise<void> {
    try {
      const emotion = this.detectEmotion(text);
      const voice = VOICES[language];
      
      let rate: string;
      let pitch: string;

      if (language === 'zh') {
        switch (emotion) {
          case 'excited':
            rate = '+5%';
            pitch = '+8Hz';
            break;
          case 'questioning':
            rate = '-8%';
            pitch = '+5Hz';
            break;
          case 'cheerful':
            rate = '+0%';
            pitch = '+3Hz';
            break;
          default:
            rate = '-5%';
            pitch = '+0Hz';
        }
      } else {
        switch (emotion) {
          case 'excited':
            rate = '+5%';
            pitch = '+10Hz';
            break;
          case 'questioning':
            rate = '-5%';
            pitch = '+5Hz';
            break;
          case 'cheerful':
            rate = '+0%';
            pitch = '+5Hz';
            break;
          default:
            rate = '-8%';
            pitch = '+0Hz';
        }
      }

      const cacheKey = this.getCacheKey(text, voice, rate, pitch);

      if (this.audioCache.has(cacheKey)) {
        console.log(`[EdgeTtsService] 预加载跳过，已在缓存中: "${text.substring(0, 30)}..."`);
        return;
      }

      console.log(`[EdgeTtsService] 开始预加载: "${text.substring(0, 30)}..."`);
      await this.synthesizeAudio(text, voice, rate, pitch);
      console.log(`[EdgeTtsService] 预加载完成: "${text.substring(0, 30)}..."`);
    } catch (error) {
      console.warn('[EdgeTtsService] 预加载失败:', error);
      // 预加载失败不影响主流程，静默处理
    }
  }

  /**
   * 生成缓存键
   */
  private getCacheKey(text: string, voice: string, rate: string, pitch: string): string {
    return `${text}|${voice}|${rate}|${pitch}`;
  }

  private detectEmotion(text: string): 'normal' | 'excited' | 'questioning' | 'cheerful' {
    const trimmed = text.trim();
    if (trimmed.endsWith('!') || trimmed.endsWith('！')) return 'excited';
    if (trimmed.endsWith('?') || trimmed.endsWith('？')) return 'questioning';
    return 'normal';
  }

  private splitText(text: string): Array<{ text: string; language: 'en' | 'zh' }> {
    const segments: Array<{ text: string; language: 'en' | 'zh' }> = [];
    let currentText = '';
    let currentLang: 'en' | 'zh' | null = null;

    const isChinese = (char: string) => /[\u4e00-\u9fff]/.test(char);
    const isEnglish = (char: string) => /[a-zA-Z]/.test(char);

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const charIsChinese = isChinese(char);
      const charIsEnglish = isEnglish(char);

      let charLang: 'en' | 'zh' | null = null;
      if (charIsChinese) charLang = 'zh';
      else if (charIsEnglish) charLang = 'en';

      if (charLang !== currentLang && currentText.length > 0) {
        if (currentLang) {
          segments.push({ text: currentText.trim(), language: currentLang });
        }
        currentText = char;
        currentLang = charLang;
      } else {
        currentText += char;
        if (charLang) currentLang = charLang;
      }
    }

    if (currentText.trim().length > 0 && currentLang) {
      segments.push({ text: currentText.trim(), language: currentLang });
    }

    return segments;
  }

  /**
   * 调用 Supabase Edge Function 合成音频
   */
  private async synthesizeAudio(text: string, voice: string, rate: string, pitch: string): Promise<string> {
    const cacheKey = this.getCacheKey(text, voice, rate, pitch);

    // 检查缓存
    if (this.audioCache.has(cacheKey)) {
      console.log(`[EdgeTtsService] 从缓存获取音频，无需请求 API`);
      return this.audioCache.get(cacheKey)!;
    }

    console.log(`[EdgeTtsService] 调用 TTS API: voice=${voice}, rate=${rate}, pitch=${pitch}`);

    const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

    const response = await fetch(TTS_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseAnonKey,
        'Authorization': `Bearer ${supabaseAnonKey}`,
      },
      body: JSON.stringify({
        text,
        voice,
        rate,
        pitch,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`TTS API failed: ${response.status} - ${errorText}`);
    }

    // 解析 JSON 响应
    const data = await response.json();
    console.log(`[EdgeTtsService] 接收到响应:`, { success: data.success, audioBase64Length: data.audioBase64?.length });

    if (!data.success || !data.audioBase64) {
      throw new Error('TTS API returned invalid response');
    }

    // 直接使用后端返回的 base64 字符串，添加 data URI 前缀
    const audioUri = 'data:audio/mpeg;base64,' + data.audioBase64;
    console.log(`[EdgeTtsService] 音频 URI 准备完成，长度: ${audioUri.length}`);

    // 存入缓存
    this.audioCache.set(cacheKey, audioUri);
    console.log(`[EdgeTtsService] 音频已缓存，当前缓存数: ${this.audioCache.size}`);

    return audioUri;
  }

  async speak(options: TtsOptions): Promise<() => void> {
    const { text, language = 'en', emotion, onStart, onDone, onError, onProgress } = options;

    const detectedEmotion = emotion || this.detectEmotion(text);

    console.log(`[EdgeTtsService] 播放: [${language}][${detectedEmotion}] "${text.substring(0, 30)}..."`);

    this.isPlaying = true;
    this.currentText = text;
    this.onDoneCallback = onDone || null;
    this.onProgressCallback = onProgress || null;

    try {
      let voice: string;
      let rate: string;
      let pitch: string;

      if (language === 'zh') {
        voice = VOICES.zh;
        switch (detectedEmotion) {
          case 'excited':
            rate = '+5%';
            pitch = '+8Hz';
            break;
          case 'questioning':
            rate = '-8%';
            pitch = '+5Hz';
            break;
          case 'cheerful':
            rate = '+0%';
            pitch = '+3Hz';
            break;
          default:
            rate = '-5%';
            pitch = '+0Hz';
        }
      } else {
        voice = VOICES.en;
        switch (detectedEmotion) {
          case 'excited':
            rate = '+5%';
            pitch = '+10Hz';
            break;
          case 'questioning':
            rate = '-5%';
            pitch = '+5Hz';
            break;
          case 'cheerful':
            rate = '+0%';
            pitch = '+5Hz';
            break;
          default:
            rate = '-8%';
            pitch = '+2Hz';
        }
      }

      console.log(`[EdgeTtsService] 音色: ${voice}, rate: ${rate}, pitch: ${pitch}`);

      const audioUri = await this.synthesizeAudio(text, voice, rate, pitch);

      await this.playAudio(audioUri, onStart, () => {
        this.isPlaying = false;
        this.clearProgressInterval();
        if (this.onDoneCallback) {
          this.onDoneCallback();
          this.onDoneCallback = null;
        }
        onDone?.();
      }, onError);

    } catch (error) {
      console.error('[EdgeTtsService] 合成失败:', error);
      this.isPlaying = false;
      this.clearProgressInterval();
      onError?.(error);
    }

    return () => this.stop();
  }

  private async playAudio(
    uri: string,
    onStart?: () => void,
    onDone?: () => void,
    onError?: (error: any) => void
  ): Promise<void> {
    try {
      // 先触发 onStart，让用户立即知道开始播放了
      onStart?.();

      if (this.sound) {
        await this.sound.unloadAsync();
        this.sound = null;
      }

      console.log('[EdgeTtsService] 播放音频，URI 长度:', uri.length);

      const { sound } = await Audio.Sound.createAsync(
        { uri },
        {
          shouldPlay: true,
          progressUpdateIntervalMillis: 200,
          // 优化：让音频更快加载
          isLooping: false,
          shouldCorrectPitch: false,
        },
        (status) => {
          if (status.isLoaded && status.didJustFinish) {
            onDone?.();
          }
          // 移除不存在的 error 属性访问
        }
      );

      this.sound = sound;
      this.startProgressInterval();

    } catch (error) {
      console.error('[EdgeTtsService] 播放失败:', error);
      onError?.(error);
    }
  }

  private startProgressInterval(): void {
    this.clearProgressInterval();
    let charIndex = 0;
    const textLength = this.currentText.length;

    this.progressInterval = setInterval(() => {
      if (this.onProgressCallback && charIndex < textLength) {
        charIndex++;
        this.onProgressCallback(Math.min(charIndex, textLength));
      }
    }, 200);
  }

  private clearProgressInterval(): void {
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
      this.progressInterval = null;
    }
  }

  stop(): void {
    this.clearProgressInterval();
    this.isPlaying = false;
    if (this.sound) {
      this.sound.unloadAsync();
      this.sound = null;
    }
  }

  /**
   * 混合播放（支持中英文自动切换）
   */
  async speakMixed(
    text: string,
    onStart?: () => void,
    onDone?: () => void,
    onError?: (error: any) => void,
    onProgress?: (segmentIndex: number, charIndex: number) => void
  ): Promise<() => void> {
    const segments = this.splitText(text);
    console.log(`[EdgeTtsService] 混合播放，共 ${segments.length} 段`);

    if (segments.length === 0) {
      onDone?.();
      return () => {};
    }

    // 检查是否是纯英文或纯中文
    const hasEnglish = segments.some(s => s.language === 'en');
    const hasChinese = segments.some(s => s.language === 'zh');
    const isPure = !hasEnglish || !hasChinese;

    if (isPure) {
      // 纯英文或纯中文，直接一次性播放
      console.log(`[EdgeTtsService] 纯 ${hasEnglish ? '英文' : '中文'}，直接一次性播放`);
      const language = hasEnglish ? 'en' : 'zh';
      return await this.speak({
        text,
        language,
        onStart,
        onDone,
        onError,
        onProgress: (charIndex) => onProgress?.(0, charIndex)
      });
    }

    // 确实是混合语言，按片段播放
    let currentSegmentIndex = 0;
    let isCancelled = false;

    const playNextSegment = async () => {
      if (isCancelled || currentSegmentIndex >= segments.length) {
        onDone?.();
        return;
      }

      const segment = segments[currentSegmentIndex];

      await this.speak({
        text: segment.text,
        language: segment.language,
        onStart: currentSegmentIndex === 0 ? onStart : undefined,
        onDone: () => {
          currentSegmentIndex++;
          playNextSegment();
        },
        onError,
        onProgress: (charIndex) => {
          onProgress?.(currentSegmentIndex, charIndex);
        }
      });
    };

    playNextSegment();

    return () => {
      isCancelled = true;
      this.stop();
    };
  }
}

export default new EdgeTtsService();