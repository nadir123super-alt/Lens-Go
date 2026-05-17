/**
 * useGlobalSpeech — 全局发音管理器 v4（基于 Edge TTS 服务，全情感支持）
 *
 * 核心特性：
 * 1. 自动拆分中英文：正则匹配拆分 English (en-US) 和 Chinese (zh-CN) 片段
 * 2. 串联播放：英文片段结束后自动触发中文片段，保持连贯
 * 3. 深度音色筛选：英文优先匹配 enhanced/premium/siri 关键字音色
 * 4. 全情感化朗读：使用 Edge TTS <mstts:express-as> 风格标签
 *    - 支持 9 种情感：normal, cheerful, sad, angry, friendly, whispering, excited, calm, disgruntled
 *    - 智能情感检测：基于关键词、标点、短语模式自动匹配
 * 5. 句子间停顿：标点后加入逗号，模拟真人呼吸断句
 * 6. 即点即停：快速切换时停止上一段播放
 * 7. 完整回调：onDone 回调正确触发
 * 8. 双进度模式：片段级进度 + 全局字符进度
 *
 * 供【拍照识别】、【普通口语练习】、【AI实时通话】、【历史对话记录】四个模块统一调用
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import edgeTtsService, { EmotionStyle } from '../services/edgeTtsService';

export interface SpeechSegment {
  text: string;
  language: 'en' | 'zh';
  emotion?: EmotionStyle;
}

export interface UseGlobalSpeechReturn {
  status: 'idle' | 'speaking';
  isSpeaking: boolean;
  speak: (
    text: string,
    onDone?: () => void,
    onProgress?: (segmentIndex: number, charIndex: number) => void,
    onGlobalCharProgress?: (charIndex: number) => void
  ) => void;
  stop: () => void;
}

export function useGlobalSpeech(): UseGlobalSpeechReturn {
  const [status, setStatus] = useState<'idle' | 'speaking'>('idle');
  const segmentsRef = useRef<SpeechSegment[]>([]);
  const currentSegmentIndexRef = useRef(0);
  const isPlayingRef = useRef(false);
  const onDoneCallbackRef = useRef<(() => void) | null>(null);
  const onProgressCallbackRef = useRef<((segmentIndex: number, charIndex: number) => void) | null>(null);
  const onGlobalCharProgressCallbackRef = useRef<((charIndex: number) => void) | null>(null);
  const isStoppedRef = useRef(false);
  const stopFnRef = useRef<(() => void) | null>(null);
  const totalCharCountRef = useRef(0);

  // 初始化 Edge TTS 服务
  useEffect(() => {
    edgeTtsService.init();
  }, []);

  /**
   * 拆分中英文文本
   */
  const splitText = useCallback((text: string): SpeechSegment[] => {
    const segments: SpeechSegment[] = [];
    let currentText = '';
    let currentLang: 'en' | 'zh' | null = null;

    const isChinese = (char: string): boolean => /[\u4e00-\u9fff]/.test(char);
    // 英文字符：字母 + 撇号（支持缩写如 there's, don't, I'll, we're）+ 数字
    const isEnglish = (char: string): boolean => /[a-zA-Z'0-9]/.test(char);

    const detectEmotion = (txt: string): EmotionStyle => {
      // 使用 edgeTtsService 的智能情感检测（关键词+标点+短语模式）
      return edgeTtsService.detectEmotion(txt);
    };

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const charIsChinese = isChinese(char);
      const charIsEnglish = isEnglish(char);

      let charLang: 'en' | 'zh' | null = null;
      if (charIsChinese) charLang = 'zh';
      else if (charIsEnglish) charLang = 'en';

      if (charLang !== currentLang && currentText.length > 0) {
        if (currentLang && currentText.trim().length > 0) {
          const emotion = detectEmotion(currentText);
          segments.push({ text: currentText.trim(), language: currentLang, emotion });
        }
        currentText = char;
        currentLang = charLang;
      } else {
        currentText += char;
        if (charLang) currentLang = charLang;
      }
    }

    if (currentText.trim().length > 0 && currentLang) {
      const emotion = detectEmotion(currentText);
      segments.push({ text: currentText.trim(), language: currentLang, emotion });
    }

    console.log('[useGlobalSpeech] 拆分结果:', segments.map(s =>
      `[${s.language}][${s.emotion || 'normal'}]${s.text.substring(0, 20)}`
    ));
    return segments;
  }, []);

  /**
   * 串联播放所有片段
   */
  const playAllSegments = useCallback(async () => {
    const segments = segmentsRef.current;
    const fullText = segments.map(s => s.text).join(' ');

    // 预计算每个片段的字符位置，用于全局字符进度
    const segmentStartChars: number[] = [];
    let currentPos = 0;
    for (const seg of segments) {
      segmentStartChars.push(currentPos);
      currentPos += seg.text.length + 1; // +1 用于空格
    }

    // 收集每个片段的情感信息
    const emotions: EmotionStyle[] = segments.map(s => s.emotion || 'normal');

    const stopFn = await edgeTtsService.speakMixed(
      fullText,
      () => {
        console.log('[useGlobalSpeech] 开始播放');
        // 触发 onStart 回调（通过第一个 onProgress）
        if (onGlobalCharProgressCallbackRef.current) {
          onGlobalCharProgressCallbackRef.current(0);
        }
      },
      () => {
        if (!isStoppedRef.current) {
          console.log('[useGlobalSpeech] 所有片段播放完成');
          isPlayingRef.current = false;
          setStatus('idle');

          // 确保最后一个回调是完整文本
          if (onGlobalCharProgressCallbackRef.current) {
            onGlobalCharProgressCallbackRef.current(fullText.length);
          }

          if (onDoneCallbackRef.current) {
            onDoneCallbackRef.current();
            onDoneCallbackRef.current = null;
          }
        }
      },
      undefined,
      (segmentIndex: number, charIndex: number) => {
        // 计算全局字符位置
        let globalCharIndex = charIndex;
        if (segmentIndex > 0 && segmentIndex < segmentStartChars.length) {
          globalCharIndex = segmentStartChars[segmentIndex] + charIndex;
        }

        if (onProgressCallbackRef.current) {
          onProgressCallbackRef.current(segmentIndex, charIndex);
        }

        if (onGlobalCharProgressCallbackRef.current) {
          onGlobalCharProgressCallbackRef.current(globalCharIndex);
        }
      },
      emotions  // 传递情感数组
    );

    stopFnRef.current = stopFn;
  }, []);

  /**
   * 停止播放
   */
  const stop = useCallback(() => {
    console.log('[useGlobalSpeech] stop() 被调用');
    isStoppedRef.current = true;
    isPlayingRef.current = false;
    setStatus('idle');

    if (stopFnRef.current) {
      stopFnRef.current();
      stopFnRef.current = null;
    }

    edgeTtsService.stop();

    onDoneCallbackRef.current = null;
    onProgressCallbackRef.current = null;
    onGlobalCharProgressCallbackRef.current = null;
    segmentsRef.current = [];
    currentSegmentIndexRef.current = 0;
  }, []);

  /**
   * 主播放函数
   */
  const speak = useCallback((
    text: string,
    onDone?: () => void,
    onProgress?: (segmentIndex: number, charIndex: number) => void,
    onGlobalCharProgress?: (charIndex: number) => void
  ) => {
    console.log(`[useGlobalSpeech] speak() 被调用: "${text.substring(0, 50)}..."`);

    // 先停止当前播放
    stop();

    // 重置状态
    isStoppedRef.current = false;
    isPlayingRef.current = true;
    onDoneCallbackRef.current = onDone || null;
    onProgressCallbackRef.current = onProgress || null;
    onGlobalCharProgressCallbackRef.current = onGlobalCharProgress || null;

    const cleanedText = text.trim();
    if (!cleanedText) {
      console.warn('[useGlobalSpeech] 文本为空，跳过播放');
      return;
    }

    const segments = splitText(cleanedText);
    if (segments.length === 0) {
      console.warn('[useGlobalSpeech] 拆分后无有效片段');
      return;
    }

    totalCharCountRef.current = cleanedText.length;
    segmentsRef.current = segments;
    currentSegmentIndexRef.current = 0;
    setStatus('speaking');

    console.log('[useGlobalSpeech] 开始串联播放（Edge TTS v3）');
    playAllSegments();
  }, [stop, splitText, playAllSegments]);

  return {
    status,
    isSpeaking: status === 'speaking',
    speak,
    stop,
  };
}

/**
 * 全局单例 TTS 实例
 */
let globalSpeechInstance: ReturnType<typeof useGlobalSpeech> | null = null;

export function getGlobalSpeech(): ReturnType<typeof useGlobalSpeech> {
  if (!globalSpeechInstance) {
    globalSpeechInstance = useGlobalSpeech();
  }
  return globalSpeechInstance;
}
