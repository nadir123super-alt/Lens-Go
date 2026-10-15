/**
 * TTS 服务 v8 — 系统原生语音（expo-speech）
 *
 * 变更说明（v8）：
 * - 从「微软 Edge TTS 神经网络语音（网络合成）」切换为「系统自带 TTS（expo-speech）」
 * - 原因：Edge TTS 每次需经 Supabase Edge Function → 微软服务合成，存在明显延迟，
 *         弱网/被墙时会出现「点击没反应」。系统 TTS 本地即时发声，零延迟。
 * - 对外 API 完全保持不变（speak / speakMixed / stop / init / preload / detectEmotion），
 *   因此所有调用方（useGlobalSpeech、soundManager、search、practice 等）无需改动。
 *
 * 保留能力：
 * 1. 中英文自动分离 + 串联播放（speakMixed）
 * 2. 智能情感检测（detectEmotion）—— 系统 TTS 不支持情感标签，仅用于日志/兼容
 * 3. 字符级进度回调（基于 expo-speech 的 onBoundary / 时间估算）
 * 4. 即点即停（stop）
 * 5. 用户语速设置（getSpeechRate）
 *
 * 音色：
 * - 英文：系统默认英文语音（language: 'en-US'）
 * - 中文：系统默认中文语音（language: 'zh-CN'）
 */

import * as Speech from 'expo-speech';
import { getSpeechRate } from './speechSettingsService';

// ====== 情感风格定义（保留类型，供上层兼容使用）======
export type EmotionStyle = 'normal' | 'cheerful' | 'sad' | 'angry' | 'friendly' | 'whispering' | 'excited' | 'calm' | 'disgruntled';

interface TtsOptions {
  text: string;
  language?: 'en' | 'zh';
  emotion?: EmotionStyle;
  onStart?: () => void;
  onDone?: () => void;
  onError?: (error: any) => void;
  onProgress?: (charIndex: number) => void;
}

// 系统 TTS 语言代码
const SYSTEM_LANG: Record<'en' | 'zh', string> = {
  en: 'en-US',
  zh: 'zh-CN',
};

// BASE_RATE = 0.9：将系统当前的 0.9x 物理语速设定为新的 1.0x 标准语速
const BASE_RATE = 0.9;

class EdgeTtsService {
  private isPlaying = false;
  private currentText = '';
  private onDoneCallback: (() => void) | null = null;
  private onProgressCallback: ((charIndex: number) => void) | null = null;
  private progressTimer: ReturnType<typeof setTimeout> | null = null;
  // 用于在 stop() 时解除 speakMixed 中 Promise 的挂起
  private resolveCurrentPromise: (() => void) | null = null;
  // 当前播放的 utterance 标识（用于忽略过期回调）
  private playToken = 0;

  async init(): Promise<void> {
    console.log('[TTS] 使用系统原生语音（expo-speech）作为 TTS 引擎');
  }

  /**
   * 预加载：系统 TTS 无需预加载，保留空实现以兼容调用方
   */
  async preload(_text: string, _language: 'en' | 'zh' = 'en'): Promise<void> {
    // 系统 TTS 本地即时发声，无需预加载
  }

  /**
   * 智能情绪检测（保留实现，供上层日志/兼容使用）
   * 系统 TTS 不支持情感标签，检测结果不影响发声。
   */
  detectEmotion(text: string): EmotionStyle {
    const trimmed = text.trim().toLowerCase();

    // 感叹号 → 兴奋
    if (/!/.test(trimmed)) return 'excited';
    // 问号 → 疑问（映射为 friendly）
    if (/\?/.test(trimmed)) return 'friendly';

    // 关键词检测
    const excitedWords = ['awesome', 'amazing', 'fantastic', 'wonderful', 'great', 'excellent', 'perfect', 'brilliant', 'incredible', 'love', 'lovely', 'beautiful', 'congratulations', 'well done', 'good job', 'keep it up', 'you did it'];
    const sadWords = ['sorry', 'sad', 'unfortunately', 'bad', 'terrible', 'awful', 'poor', 'fail', 'failed', 'wrong', 'mistake'];
    const angryWords = ['angry', 'mad', 'furious', 'hate', 'stupid', 'idiot', 'damn'];
    const calmWords = ['well', 'hmm', 'um', 'uh', 'er', 'meh', 'huh', 'eh'];

    if (excitedWords.some(w => trimmed.includes(w))) return 'excited';
    if (sadWords.some(w => trimmed.includes(w))) return 'sad';
    if (angryWords.some(w => trimmed.includes(w))) return 'angry';
    if (calmWords.some(w => trimmed === w || trimmed.startsWith(w + ' '))) return 'calm';

    return 'normal';
  }

  /**
   * 按句子拆分文本（句号、问号、感叹号、换行符）
   */
  private splitSentences(text: string): string[] {
    const sentences: string[] = [];
    const regex = /[^.!?\n。！？]+[.!?。！？]|\n+|[^.!?\n。！？]+/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const s = match[0].trim();
      if (s) {
        if (/^\n+$/.test(s)) continue;
        sentences.push(s);
      }
    }
    return sentences.length > 0 ? sentences : [text.trim()];
  }

  /**
   * 拆分中英文文本为片段
   */
  private splitText(text: string): { text: string; language: 'en' | 'zh' }[] {
    const segments: { text: string; language: 'en' | 'zh' }[] = [];
    let currentText = '';
    let currentLang: 'en' | 'zh' | null = null;

    const isChinese = (char: string): boolean => /[\u4e00-\u9fff]/.test(char);
    const isEnglish = (char: string): boolean => /[a-zA-Z'0-9]/.test(char);

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      let charLang: 'en' | 'zh' | null = null;
      if (isChinese(char)) charLang = 'zh';
      else if (isEnglish(char)) charLang = 'en';

      if (charLang !== currentLang && currentText.length > 0) {
        if (currentLang && currentText.trim().length > 0) {
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
   * 使用系统 TTS 播放单段文本（核心方法）
   */
  async speak(options: TtsOptions): Promise<() => void> {
    const { text, language = 'en', onStart, onDone, onError, onProgress } = options;

    console.log(`[TTS] speak() 被调用: [${language}] "${text.substring(0, 40)}..."`);

    // 先停止上一段
    this.stop();

    const token = ++this.playToken;
    this.isPlaying = true;
    this.currentText = text;
    this.onDoneCallback = onDone || null;
    this.onProgressCallback = onProgress || null;

    // 立即触发 onStart，让 UI 即时响应
    onStart?.();

    // 应用用户语速 + 基准校准
    const userRate = getSpeechRate();
    const adjustedRate = userRate * BASE_RATE;
    const systemLang = SYSTEM_LANG[language];

    // 进度估算：系统 TTS 无精确字符回调，使用时间估算模拟
    this.startEstimatedProgress(text, adjustedRate);

    try {
      Speech.speak(text, {
        language: systemLang,
        rate: adjustedRate,
        pitch: 1.0,
        volume: 1.0,
        onDone: () => {
          if (token !== this.playToken) return; // 已被新播放取代
          console.log('[TTS] 系统 TTS 播放完成');
          this.isPlaying = false;
          this.clearProgressTimer();
          if (this.onProgressCallback) {
            this.onProgressCallback(text.length);
          }
          const cb = this.onDoneCallback;
          this.onDoneCallback = null;
          this.onProgressCallback = null;
          this.currentText = '';
          cb?.();
        },
        onStopped: () => {
          if (token !== this.playToken) return;
          console.log('[TTS] 系统 TTS 被停止');
          this.isPlaying = false;
          this.clearProgressTimer();
        },
        onError: (error: any) => {
          if (token !== this.playToken) return;
          console.warn('[TTS] 系统 TTS 播放出错:', error?.message || error);
          this.isPlaying = false;
          this.clearProgressTimer();
          const cb = this.onDoneCallback;
          this.onDoneCallback = null;
          this.onProgressCallback = null;
          this.currentText = '';
          onError?.(error);
          // 出错也触发 onDone，避免上层卡住
          cb?.();
        },
      });
    } catch (e: any) {
      console.error('[TTS] Speech.speak() 抛出异常:', e?.message || e);
      this.isPlaying = false;
      this.clearProgressTimer();
      onError?.(e);
      onDone?.();
    }

    return () => this.stop();
  }

  /**
   * 基于文本长度与语速估算字符级进度（模拟 KTV 高亮）
   */
  private startEstimatedProgress(text: string, rate: number): void {
    this.clearProgressTimer();
    if (!this.onProgressCallback) return;

    // 估算总时长：英文约 60ms/字符，中文约 180ms/字符，再按语速缩放
    const isChineseText = /[\u4e00-\u9fff]/.test(text);
    const perCharMs = isChineseText ? 180 : 60;
    const totalMs = Math.max(300, text.length * perCharMs / Math.max(0.1, rate));
    const stepMs = 50;
    const totalSteps = Math.max(1, Math.floor(totalMs / stepMs));

    let step = 0;
    this.progressTimer = setInterval(() => {
      if (!this.isPlaying) {
        this.clearProgressTimer();
        return;
      }
      step++;
      const ratio = Math.min(1, step / totalSteps);
      const charIndex = Math.round(ratio * text.length);
      if (this.onProgressCallback) {
        this.onProgressCallback(Math.min(charIndex, text.length));
      }
      if (step >= totalSteps) {
        this.clearProgressTimer();
      }
    }, stepMs);
  }

  private clearProgressTimer(): void {
    if (this.progressTimer) {
      clearInterval(this.progressTimer);
      this.progressTimer = null;
    }
  }

  /**
   * 停止播放
   */
  stop(): void {
    this.playToken++; // 使旧回调失效
    this.clearProgressTimer();
    this.isPlaying = false;
    try {
      Speech.stop();
    } catch {
      // 忽略
    }
    // 解除 speakMixed 中可能挂起的 Promise
    if (this.resolveCurrentPromise) {
      this.resolveCurrentPromise();
      this.resolveCurrentPromise = null;
    }
    this.onDoneCallback = null;
    this.onProgressCallback = null;
    this.currentText = '';
  }

  /**
   * 混合播放（支持中英文自动切换）
   *
   * @param text - 要播放的文本
   * @param onStart - 开始播放回调
   * @param onDone - 播放完成回调
   * @param onError - 错误回调
   * @param onProgress - 进度回调 (segmentIndex, charIndex)
   * @param emotions - 可选，每个片段对应的情感数组（系统 TTS 忽略）
   */
  async speakMixed(
    text: string,
    onStart?: () => void,
    onDone?: () => void,
    onError?: (error: any) => void,
    onProgress?: (segmentIndex: number, charIndex: number) => void,
    _emotions?: EmotionStyle[]
  ): Promise<() => void> {
    const segments = this.splitText(text);
    console.log(`[TTS] speakMixed 被调用, text="${text.substring(0, 80)}...", segments=${segments.length}`);

    if (segments.length === 0) {
      console.log('[TTS] ⚠️ 无有效片段，直接回调 onDone');
      onDone?.();
      return () => {};
    }

    const hasEnglish = segments.some(s => s.language === 'en');
    const hasChinese = segments.some(s => s.language === 'zh');
    const isPure = !hasEnglish || !hasChinese;

    let isCancelled = false;

    if (isPure) {
      // 纯英文或纯中文：直接一次性播放整段文本
      const language = hasEnglish ? 'en' : 'zh';
      console.log(`[TTS] 🎯 纯 ${language}，直接播放整段文本`);

      this.speak({
        text,
        language,
        onStart,
        onDone,
        onError,
        onProgress: (charIndex) => {
          onProgress?.(0, charIndex);
        },
      });

      return () => {
        isCancelled = true;
        this.stop();
      };
    }

    // 混合语言：按片段串联播放
    console.log(`[TTS] 🔀 混合语言路径，${segments.length} 个片段`);
    (async () => {
      for (let i = 0; i < segments.length; i++) {
        if (isCancelled) break;

        const segment = segments[i];
        console.log(`[TTS] ▶️ 播放第 ${i + 1}/${segments.length} 段: "${segment.text.substring(0, 40)}..."`);

        // 片段间短暂停顿
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, 250));
          if (isCancelled) break;
        }

        await new Promise<void>((resolve, reject) => {
          this.resolveCurrentPromise = resolve;
          this.speak({
            text: segment.text,
            language: segment.language,
            onStart: i === 0 ? onStart : undefined,
            onDone: () => {
              this.resolveCurrentPromise = null;
              resolve();
            },
            onError: (error) => {
              this.resolveCurrentPromise = null;
              reject(error);
            },
            onProgress: (charIndex) => {
              onProgress?.(i, charIndex);
            },
          });
        });
      }
      if (!isCancelled) {
        console.log('[TTS] 🎉 所有片段播放完成，触发 onDone');
        onDone?.();
      }
    })();

    return () => {
      isCancelled = true;
      this.stop();
    };
  }
}

export default new EdgeTtsService();
