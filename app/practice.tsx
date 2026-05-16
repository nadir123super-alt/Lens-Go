/**
 * PracticeScreen — 阶梯式口语练习（单词 → 例句）
 *
 * === 交互节奏 v2 ===
 *
 * 1. 单词→例句自动停顿：
 *    - 单词阶段达标后 → 展示分数覆盖层 1.8 秒（录音按钮禁用）
 *    - 停顿结束后自动切换到例句阶段（同位置淡入淡出）
 *
 * 2. 单词组之间手动翻页（"下一题"按钮）：
 *    - 例句阶段达标后 → 停留在评分结果界面
 *    - 底部显示【下一题】按钮，用户手动点击后才加载下一个单词
 *    - 禁止自动跳转
 *
 * 3. 布局稳定性：
 *    - 录音按钮区和"下一题"按钮区共用固定高度容器，无位移
 *    - 中央卡片容器固定 padding，无音量波形条，文字不因录音状态位移
 *
 * 4. 字号差异化：
 *    - 单词阶段：wordText 32px（醒目）
 *    - 例句阶段：sentenceText 24px（适配长句，不拥挤）
 *
 * 5. 状态持久化：
 *    - 用户切到其他 Tab 再回来时，保持当前进度
 *    - initSession 只挂载时执行一次，不重置状态
 */
import AchievementUnlockModal from '@/components/AchievementUnlockModal';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { consumePreloadedPractice } from '@/services/dataPreloader';
import { usePracticeContext } from '@/services/practiceContext';
import {
  consumePendingSession,
  evaluateSpeechWithRetry,
  fetchNextPracticeSet,
  fillSkippedScores,
  getCurrentSentence,
  getCurrentWord,
  getScoreFeedback,
  isAllPerfect,
  PracticeSession,
  recordStageScore,
  savePendingScores,
  skipCard,
  TaskStage
} from '@/services/practiceService';
import {
  forceStopRecording,
  requestAudioPermission,
  setAutoStopCallback,
  setVolumeMeteringCallback,
  startRecording,
  stopRecordingWithVolume,
  VOLUME_THRESHOLD_DB
} from '@/services/recordingService';
import { stopAll } from '@/services/soundManager';
import { recordLearningActivity } from '@/services/studyStatsService';
import { destroyTTS, initTTS, playTextWithCharProgress, stopTTS } from '@/services/ttsService';

type Phase =
  | 'ready'
  | 'recording'
  | 'scoring'
  | 'sentence_transition_pause'
  | 'sentence_ready'
  | 'result_next'
  | 'result_complete'
  | 'network_error'
  | 'empty_audio_toast'
  | 'volume_low_toast'
  | 'too_short_toast'
  | 'permission_denied_toast'
  | 'complete'
  | 'empty';

const ANCHOR = '#FF6B6B';
const SENTENCE_TRANSITION_DELAY = 1800;

/**
 * 播放文本并更新高亮进度（KTV式字符级同步高亮）
 * 使用 react-native-tts 的实时字符进度回调
 */
function playWithHighlightHelper(
  text: string, 
  isWordMode: boolean, 
  setHighlightProgress: React.SetStateAction<number> | ((value: React.SetStateAction<number>) => void),
  setCharProgress?: (value: React.SetStateAction<number>) => void
) {
  // 确保是函数类型
  const setProgress = typeof setHighlightProgress === 'function' 
    ? setHighlightProgress 
    : () => {};
  
  const setChar = typeof setCharProgress === 'function'
    ? setCharProgress
    : () => {};
    
  // 重置进度（同时重置，避免闪烁）
  setProgress(0);
  setChar(0);
  
  if (isWordMode) {
    // 单词模式：直接使用 TTS 的字符进度回调，逐个字母点亮
    playTextWithCharProgress(
      text,
      () => setProgress(text.length),
      (charIndex) => setProgress(charIndex)
    );
  } else {
    // 例句模式：使用 TTS 的字符进度回调，追踪当前单词和字母位置
    const words = text.split(/\s+/).filter(w => w.length > 0);
    
    // 预计算每个单词的起始字符位置（用于快速查找）
    const wordStartPositions: number[] = [];
    let position = 0;
    words.forEach((word, index) => {
      wordStartPositions.push(position);
      position += word.length + 1; // +1 用于空格
    });
    
    playTextWithCharProgress(
      text,
      () => {
        // 播放完成
        setProgress(words.length);
        setChar(0);
      },
      (charIndex) => {
        // TTS 引擎实时回调：当前正在播放的字符索引
        // 找到当前字符属于哪个单词
        let currentWordIndex = words.length - 1;
        for (let i = 0; i < words.length; i++) {
          const nextStart = i < words.length - 1 ? wordStartPositions[i + 1] : text.length;
          if (charIndex >= wordStartPositions[i] && charIndex < nextStart) {
            currentWordIndex = i;
            break;
          }
        }
        
        // 计算当前单词内的字符位置
        const charInWord = charIndex - wordStartPositions[currentWordIndex];
        const wordLength = words[currentWordIndex]?.length || 0;
        
        // 更新状态
        setProgress(currentWordIndex);
        setChar(Math.min(charInWord, wordLength));
      }
    );
  }
}

export default function PracticeScreen() {
  const { finishPractice } = usePracticeContext();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // --- 核心状态 ---
  const [session, setSession] = useState<PracticeSession | null>(null);
  const [currentTask, setCurrentTask] = useState<TaskStage>('word');
  const [phase, setPhase] = useState<Phase>('ready');
  const [score, setScore] = useState(0);
  const [showBadge, setShowBadge] = useState(false);

  // 得分标注
  const [wordScoreLabel, setWordScoreLabel] = useState<number | null>(null);
  const [sentenceScoreLabel, setSentenceScoreLabel] = useState<number | null>(null);
  
  // 保存刚刚完成的单词的例句（用于 result_next 阶段显示）
  const [completedSentence, setCompletedSentence] = useState<string | null>(null);
  
  // 跟读高亮进度
  const [highlightProgress, setHighlightProgress] = useState<number>(0); // 单词：已高亮字母数，例句：已高亮单词数
  const [currentWordCharProgress, setCurrentWordCharProgress] = useState<number>(0); // 当前单词的字母进度
  
  // 录音波形数据
  const [audioLevels, setAudioLevels] = useState<number[]>(Array(20).fill(0));
  // 当前归一化音量值（0-1），用于音量条显示
  const [normalizedVolume, setNormalizedVolume] = useState(0);
  // 音量增益警告：波形几乎不动时提示用户
  const [gainWarning, setGainWarning] = useState(false);
  // 记录最近几次音量采样，判断波形是否在动
  const volumeHistoryRef = useRef<number[]>([]);

  // 网络错误重试
  const [lastAudioUri, setLastAudioUri] = useState<string | null>(null);
  const [lastTargetText, setLastTargetText] = useState<string | null>(null);

  // --- 动画 ---
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const badgeScale = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const contentFadeAnim = useRef(new Animated.Value(1)).current;

  // --- 定时器 & 防连点 ---
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const buttonDisabledRef = useRef(false);

  // 成就解锁弹窗
  const [showAchievementModal, setShowAchievementModal] = useState(false);
  const [unlockedBadgeId, setUnlockedBadgeId] = useState('');

  useEffect(() => {
    // 初始化 TTS 引擎（支持字符级进度回调）
    initTTS().catch((e) => {
      console.warn('[practice] ⚠️ TTS 初始化失败:', e);
    });
    
    // ★ 提前初始化录音系统，确保首次点击录音时一切就绪
    initRecordingSystem().catch((e) => {
      console.warn('[practice] ⚠️ 录音系统预初始化失败:', e);
    });
    
    initSession();
    
    return () => {
      if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
      forceStopRecording();
      stopTTS(); // 使用新的 TTS 停止函数
      stopAll();
      destroyTTS(); // 销毁 TTS 引擎
      console.log('[practice] 🧹 组件卸载，已清理录音 + TTS 资源');
    };
  }, []);

  // ===== 脉冲动画（评分中） =====
  useEffect(() => {
    if (phase === 'scoring') {
      pulseAnim.setValue(0);
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 0, duration: 600, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    }
  }, [phase, pulseAnim]);

  // ===== 录音系统预初始化 =====
  
  /**
   * 提前初始化录音系统，确保首次点击录音时一切就绪
   * 问题：首次进入口语练习模块时，录音对象需要时间初始化，导致第一次点击录音失败
   * 解决方案：在页面加载时提前完成所有准备工作
   */
  const initRecordingSystem = async () => {
    console.log('[practice] 🎤 开始预初始化录音系统...');
    
    // 1. 提前请求录音权限
    const hasPermission = await requestAudioPermission();
    console.log(`[practice] 🎤 录音权限: ${hasPermission ? '已获取' : '未获取'}`);
    
    // 2. 设置音频模式（录音模式）
    try {
      const { forceSpeakerOutput } = await import('@/services/recordingService');
      await forceSpeakerOutput();
      console.log('[practice] 🎤 音频模式已设置为录音模式');
    } catch (e) {
      console.warn('[practice] ⚠️ 设置音频模式失败:', e);
    }
    
    // 3. 准备录音对象（使用预加载模式，创建临时对象并立即停止，让系统预加载资源）
    try {
      const { prepareToRecord } = await import('@/services/recordingService');
      await prepareToRecord(true); // true = 预加载模式
      console.log('[practice] ✅ 录音系统预初始化完成，首次点击录音即可使用');
    } catch (e) {
      console.warn('[practice] ⚠️ 准备录音对象失败:', e);
    }
  };

  // ===== 会话管理 =====

  const initSession = async () => {
    setPhase('ready');
    setWordScoreLabel(null);
    setSentenceScoreLabel(null);
    setCurrentTask('word');
    setLastAudioUri(null);
    setLastTargetText(null);
    contentFadeAnim.setValue(1);

    // 进入口语模块时，强制音频输出到主扬声器
    try {
      const { forceSpeakerOutput, logAudioRouteStatus } = await import('@/services/recordingService');
      await forceSpeakerOutput();
      logAudioRouteStatus();
    } catch (e: any) {
      console.warn('[PracticeScreen] ⚠️ forceSpeakerOutput 失败:', e?.message);
    }

    // 优先消费预加载缓存（用户点击 Tab 图标时已发起请求）
    const preloaded = consumePreloadedPractice();
    const pending = consumePendingSession();
    console.log(
      `[PracticeScreen] initSession — preloaded=${preloaded ? `words=${preloaded.words.length}, completed=${preloaded.completed}` : 'null'}, ` +
      `pending=${pending ? `words=${pending.words.length}, completed=${pending.completed}` : 'null'}`
    );
    const s = preloaded ?? pending ?? await fetchNextPracticeSet();
    console.log(`[PracticeScreen] initSession — final session: words=${s.words.length}, completed=${s.completed}`);

    setSession(s);
    if (s.completed || s.words.length === 0) {
      setPhase('empty');
    } else {
      animateIn();
      setTimeout(() => {
        const w = getCurrentWord(s);
        if (w) playWithHighlightHelper(w.word, true, setHighlightProgress);
      }, 400);
    }
  };

  const animateIn = () => {
    fadeAnim.setValue(0);
    slideAnim.setValue(30);
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start();
  };

  const animateBadge = () => {
    badgeScale.setValue(0);
    Animated.spring(badgeScale, { toValue: 1, friction: 4, useNativeDriver: true }).start();
  };

  /** 切换到例句（同位置淡入淡出） */
  const switchToSentence = (updatedSession: PracticeSession) => {
    Animated.timing(contentFadeAnim, {
      toValue: 0,
      duration: 150,
      useNativeDriver: true,
    }).start(() => {
      setCurrentTask('sentence');
      setPhase('sentence_ready');
      setHighlightProgress(0); // 立即重置高亮进度，避免先亮后灰

      Animated.timing(contentFadeAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();

      const s = getCurrentSentence(updatedSession);
      if (s) {
        setTimeout(() => playWithHighlightHelper(s, false, setHighlightProgress, setCurrentWordCharProgress), 300);
      }
    });
  };

  const applyNextCard = (nextSession?: PracticeSession) => {
    const effectiveSession = nextSession || session;
    setWordScoreLabel(null);
    setSentenceScoreLabel(null);
    setCompletedSentence(null); // 清除保存的例句
    setCurrentTask('word');
    setScore(0);
    setPhase('ready');
    setLastAudioUri(null);
    setLastTargetText(null);
    setHighlightProgress(0); // 重置高亮进度，避免闪烁
    setCurrentWordCharProgress(0); // 重置字母进度
    contentFadeAnim.setValue(1);
    animateIn();
    setTimeout(() => {
      const w = getCurrentWord(effectiveSession!);
      if (w) playWithHighlightHelper(w.word, true, setHighlightProgress);
    }, 100);
  };

  // ===== 跳过 =====

  const handleSkip = async () => {
    if (buttonDisabledRef.current) return;
    buttonDisabledRef.current = true;
    setTimeout(() => { buttonDisabledRef.current = false; }, 500);

    if (!session) {
      console.warn('[Practice] handleSkip: session 为 null，跳过');
      return;
    }

    if (phase === 'recording') await forceStopRecording();
    stopAll();
    if (autoTimerRef.current) { clearTimeout(autoTimerRef.current); autoTimerRef.current = null; }

    const updatedSession = skipCard(session);
    if (updatedSession.completed) {
      setSession(updatedSession);
      setTimeout(() => finalizeToSummary(), 100);
      return;
    }
    setSession(updatedSession);
    applyNextCard(updatedSession);
  };

  // ===== 听音（用户点击）=====
  const handlePlaySound = useCallback(() => {
    const w = getCurrentWord(session!);
    if (!w) return;
    
    if (currentTask === 'word') {
      playWithHighlightHelper(w.word, true, setHighlightProgress);
    } else {
      const s = phase === 'result_next' && completedSentence 
        ? completedSentence 
        : getCurrentSentence(session!);
      if (s) {
        playWithHighlightHelper(s, false, setHighlightProgress, setCurrentWordCharProgress);
      }
    }
  }, [session, currentTask, phase, completedSentence]);

  // ===== 录制 & 评测 =====

  const handleRecordStart = async () => {
    if (buttonDisabledRef.current) return;
    buttonDisabledRef.current = true;
    setTimeout(() => { buttonDisabledRef.current = false; }, 300);

    const granted = await requestAudioPermission();
    if (!granted) {
      setPhase('permission_denied_toast');
      setTimeout(() => setPhase('ready'), 3000);
      return;
    }
    setPhase('recording');
    setGainWarning(false);
    volumeHistoryRef.current = [];
    
    // 初始化波形数据为一条线
    setAudioLevels(Array(20).fill(0.1));
    setNormalizedVolume(0);
    
    // 设置音量监听回调
    setVolumeMeteringCallback((volume) => {
      // ★ 改进的 dBFS 归一化：使用更宽的范围（-80 到 0），让微弱声音也能显示
      // dBFS 范围通常是 -160 到 0
      // 旧逻辑：取 -60 到 0 的范围
      // 新逻辑：取 -80 到 0 的范围，让 whisper 级别的音量也能触发波形
      const dbRange = 80; // 从 -80dB 到 0dB
      const normalized = Math.max(0, Math.min(1, (volume + dbRange) / dbRange));
      setNormalizedVolume(normalized);
      
      // 记录音量历史（用于增益检测）
      volumeHistoryRef.current.push(normalized);
      if (volumeHistoryRef.current.length > 30) {
        volumeHistoryRef.current.shift();
      }
      
      // 增益检测：如果最近 30 次采样（约 3 秒）的最大值 < 0.15，说明波形几乎不动
      if (volumeHistoryRef.current.length >= 30) {
        const maxRecent = Math.max(...volumeHistoryRef.current);
        const minRecent = Math.min(...volumeHistoryRef.current);
        const variation = maxRecent - minRecent;
        // 如果最大值很低且变化很小 → 增益可能不够
        if (maxRecent < 0.15 && variation < 0.05) {
          setGainWarning(true);
        } else {
          setGainWarning(false);
        }
      }
      
      // 更新波形数据（基于真实音量，减少随机性）
      setAudioLevels(prev => {
        const newLevels = [...prev];
        // 使用真实音量值驱动波形，中间高两边低
        for (let i = 0; i < newLevels.length; i++) {
          // 计算位置权重：中间条权重最高
          const centerIndex = (newLevels.length - 1) / 2;
          const distance = Math.abs(i - centerIndex) / centerIndex;
          const positionWeight = 1 - distance * 0.5; // 中间 1.0，边缘 0.5
          
          // 目标值 = 归一化音量 * 位置权重 + 微小随机抖动
          const targetValue = normalized * positionWeight;
          // 平滑过渡：70% 旧值 + 30% 目标值 + 微小随机
          const smoothed = prev[i] * 0.7 + targetValue * 0.3 + (Math.random() - 0.5) * 0.05;
          newLevels[i] = Math.max(0.05, Math.min(1, smoothed));
        }
        return newLevels;
      });
    });
    
    try {
      await startRecording();
      setAutoStopCallback(() => {
        autoStopHandleRecordEndRef.current();
      });
    } catch {
      setPhase('ready');
    }
  };

  const performScoring = async (uri: string, targetText: string, _keepPhase: Phase) => {
    setPhase('scoring');
    setScore(0);

    try {
      // ★ 使用带重试的评测函数：如果第一次结果为空，自动重试一次
      const { score: resultScore, isEmpty, retried } = await evaluateSpeechWithRetry(
        uri, targetText, currentTask, 1
      );

      if (isEmpty) {
        // 所有重试都返回空结果 → 显示温和提示，保持页面状态
        console.warn('[practice] ⚠️ 所有评测尝试均返回空结果，显示温和提示');
        setScore(0);
        setPhase('empty_audio_toast');
        setTimeout(() => {
          setPhase('ready');
          const w = getCurrentWord(session!);
          if (w) {
            if (currentTask === 'word') {
              playWithHighlightHelper(w.word, true, setHighlightProgress);
            } else {
              const s = getCurrentSentence(session!);
              if (s) {
                playWithHighlightHelper(s, false, setHighlightProgress, setCurrentWordCharProgress);
              }
            }
          }
        }, 3000); // 延长显示时间，让用户看清提示
        return;
      }

      if (retried) {
        console.log('[practice] ✅ 第二次重试成功');
      }

      setScore(resultScore);

      const { updatedSession, action } = await recordStageScore(session!, currentTask, resultScore);
      
      // 在更新 session 之前，保存当前单词的例句（用于 result_next 阶段显示）
      if (currentTask === 'sentence' && action !== 'session_complete') {
        const currentSentence = getCurrentSentence(session!);
        setCompletedSentence(currentSentence);
      }
      
      setSession(updatedSession);

      if (currentTask === 'word') {
        setWordScoreLabel(resultScore);
        setPhase('sentence_transition_pause');
        setTimeout(() => switchToSentence(updatedSession), SENTENCE_TRANSITION_DELAY);
        return;
      }

      setSentenceScoreLabel(resultScore);

      if (action === 'session_complete') {
        setPhase('result_complete');
        if (isAllPerfect(updatedSession.scores)) {
          setTimeout(() => { animateBadge(); setShowBadge(true); }, 800);
        }
        return;
      }

      setPhase('result_next');
    } catch (err: any) {
      if (err?.message === 'EMPTY_AUDIO') {
        setScore(0);
        setPhase('empty_audio_toast');
        setTimeout(() => {
          setPhase('ready');
          const w = getCurrentWord(session!);
          if (w) {
            if (currentTask === 'word') {
              playWithHighlightHelper(w.word, true, setHighlightProgress);
            } else {
              const s = getCurrentSentence(session!);
              if (s) {
                playWithHighlightHelper(s, false, setHighlightProgress, setCurrentWordCharProgress);
              }
            }
          }
        }, 3000);
        return;
      }
      console.error('[practice] ❌ 评测失败:', err.message);
      setPhase('network_error');
      setLastAudioUri(uri);
      setLastTargetText(targetText);
    }
  };

  const handleRecordEnd = () => {
    // 重置波形数据
    setAudioLevels(Array(20).fill(0));
    // 立即进入评分状态，让波形动画消失
    setPhase('scoring');
    
    // 在后台异步处理录音停止和评分
    processRecordingEnd();
  };
  
  const processRecordingEnd = async () => {
    let uri: string | null = null;
    let maxVolume: number = VOLUME_THRESHOLD_DB;
    let tooShort: boolean = false;
    
    try {
      ({ uri, maxVolume, tooShort } = await stopRecordingWithVolume());
    } catch (error) {
      console.warn('[practice] ⚠️ 停止录音时出错:', error);
      // 如果停止录音失败，尝试强制停止
      try {
        await forceStopRecording();
      } catch {}
      setPhase('ready');
      return;
    }
    const word = getCurrentWord(session!);

    if (tooShort) {
      setPhase('too_short_toast');
      setTimeout(() => {
        setPhase('ready');
        const w = getCurrentWord(session!);
        if (w) {
          if (currentTask === 'word') {
            playWithHighlightHelper(w.word, true, setHighlightProgress);
          } else {
            const s = getCurrentSentence(session!);
            if (s) {
              playWithHighlightHelper(s, false, setHighlightProgress, setCurrentWordCharProgress);
            }
          }
        }
      }, 1800);
      return;
    }

    if (!uri || !word) { setPhase('ready'); return; }

    const targetText = currentTask === 'word' ? word.word : getCurrentSentence(session!);
    if (!targetText) { setPhase('ready'); return; }

    // ★ 诊断：记录录音文件 URI 和大小，用于排查"空录音"问题
    try {
      const { getInfoAsync } = await import('expo-file-system/legacy');
      const info: any = await getInfoAsync(uri);
      console.log(`[practice] 📁 录音文件诊断: uri=${uri.substring(0, 60)}..., exists=${info.exists}, size=${info.size ?? 0}bytes, maxVolume=${maxVolume.toFixed(1)}dBFS, targetText="${targetText}"`);
    } catch (e: any) {
      console.log(`[practice] 📁 录音文件诊断: uri=${uri.substring(0, 60)}..., 无法获取文件信息: ${e?.message}`);
    }

    // ★ 关键修复：不再用 volume_low_toast 阻塞评分流程
    // 因为某些设备上 expo-av metering 可能不准确，用户明明说话了但音量值很低
    // 改为：如果音量低但文件存在且有数据，直接放行让评分引擎判断
    // 如果文件不存在或太小，才显示音量低提示
    if (maxVolume < VOLUME_THRESHOLD_DB) {
      // 异步检查文件是否存在且有一定大小
      let shouldSkipVolumeCheck = false;
      try {
        const { getInfoAsync } = await import('expo-file-system/legacy');
        const info: any = await getInfoAsync(uri);
        const fileSize = info.size ?? 0;
        if (info.exists && fileSize > 1024) {
          console.log(`[practice] ⚠️ 音量低 (${maxVolume.toFixed(1)}dBFS) 但文件有效 (${fileSize} bytes)，放行评分`);
          shouldSkipVolumeCheck = true;
        } else {
          console.warn(`[practice] ⚠️ 音量低且文件无效 (size=${fileSize})，显示提示`);
        }
      } catch {
        // 如果检查文件失败，仍然放行评分（宁放过，不误杀）
        console.log(`[practice] ⚠️ 音量低 (${maxVolume.toFixed(1)}dBFS) 但无法检查文件，放行评分`);
        shouldSkipVolumeCheck = true;
      }

      if (!shouldSkipVolumeCheck) {
        setPhase('volume_low_toast');
        setTimeout(() => {
          setPhase('ready');
          const w = getCurrentWord(session!);
          if (w) {
            if (currentTask === 'word') {
              playWithHighlightHelper(w.word, true, setHighlightProgress);
            } else {
              const s = getCurrentSentence(session!);
              if (s) {
                playWithHighlightHelper(s, false, setHighlightProgress, setCurrentWordCharProgress);
              }
            }
          }
        }, 2500);
        return;
      }
      // 文件有效，继续评分
    }

    await performScoring(uri, targetText, 'ready');
  };

  const autoStopHandleRecordEndRef = useRef(processRecordingEnd);
  autoStopHandleRecordEndRef.current = processRecordingEnd;

  const handleRetryScoring = async () => {
    if (!lastAudioUri || !lastTargetText) { setPhase('ready'); return; }
    await performScoring(lastAudioUri, lastTargetText, 'network_error');
  };

  const handleReRecord = () => {
    setLastAudioUri(null);
    setLastTargetText(null);
    setPhase('ready');
  };

  const handleNextCard = () => {
    if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
    applyNextCard();
  };

  const finalizeToSummary = () => {
    if (!session) return;
    const filledScores = fillSkippedScores(session);
    savePendingScores(filledScores);
    finishPractice(filledScores, session);

    // 记录学习活动（异步，不阻塞 UI）
    (async () => {
      for (const card of filledScores) {
        const bestScore = Math.max(card.wordScore || 0, card.sentenceScore || 0);
        if (bestScore > 0) {
          await recordLearningActivity(card.word, bestScore, 'practice');
        }
      }
    })();
  };

  const handleCloseBadge = () => { setShowBadge(false); finalizeToSummary(); };

  // ===== 当前数据 =====

  const current = session ? getCurrentWord(session) : null;
  // 在 result_next 阶段显示刚刚完成的单词的例句，其他阶段显示当前单词的例句
  const sentence = phase === 'result_next' && completedSentence 
    ? completedSentence 
    : (session ? getCurrentSentence(session) : null);
  const feedback = score ? getScoreFeedback(score) : null;

  const progress = session
    ? session.completed ? session.words.length : session.currentIndex
    : 0;
  const total = session?.words.length || 0;

  // ====== 空状态 ======

  if (phase === 'empty') {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 20 }]}>
        <StatusBar style="light" />
        <View style={styles.centerContent}>
          <Feather name="mic-off" size={56} color="rgba(255,255,255,0.3)" />
          <Text style={styles.emptyTitle}>还没有生词</Text>
          <Text style={styles.emptySub}>先去拍照识别几个单词再来练习吧！</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => router.push('/camera')}>
            <Feather name="camera" size={18} color="#fff" />
            <Text style={styles.primaryBtnText}>去拍照识别</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ====== 勋章弹窗 ======

  if (showBadge) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 20 }]}>
        <StatusBar style="light" />
        <View style={styles.centerContent}>
          <Animated.View style={[styles.badgeContainer, { transform: [{ scale: badgeScale }] }]}>
            <Text style={styles.badgeEmoji}>🏆</Text>
            <Text style={styles.badgeTitle}>今日口语任务达成！</Text>
            <Text style={styles.badgeSub}>所有单词和例句发音完美，继续保持！</Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={handleCloseBadge}>
              <Text style={styles.primaryBtnText}>查看成绩</Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </View>
    );
  }

  // ====== 主练习界面 ======

  const isWordStage = currentTask === 'word';

  const showScoreOverlay =
    phase === 'sentence_transition_pause' ||
    phase === 'result_next' ||
    phase === 'result_complete';

  const isRecordingDisabled =
    phase === 'scoring' ||
    phase === 'sentence_transition_pause' ||
    phase === 'result_next' ||
    phase === 'result_complete' ||
    phase === 'empty_audio_toast' ||
    phase === 'volume_low_toast' ||
    phase === 'too_short_toast' ||
    phase === 'permission_denied_toast' ||
    phase === 'network_error';

  const showBottomActionButton =
    phase === 'result_next' || phase === 'result_complete';

  const showSkip = phase !== 'result_next' && phase !== 'result_complete';

  const hintText =
    phase === 'recording'
      ? '松开结束录音'
      : phase === 'scoring'
        ? ''
        : phase === 'sentence_transition_pause'
          ? ''
          : phase === 'network_error'
              ? '网络不稳定'
              : phase === 'empty_audio_toast'
                ? '声音较小，请重试'
                : phase === 'volume_low_toast'
                  ? '未检测到有效声音'
                  : phase === 'too_short_toast'
                    ? '录音时间太短'
                    : '';

  return (
    <View style={[styles.container, { paddingTop: insets.top + 20 }]}>
      <StatusBar style="light" />

      {/* ===== 顶部栏 ===== */}
      <View style={styles.topBar}>
        <View style={styles.backBtn} />
        <Text style={styles.topTitle}>口语练习</Text>
        <View style={styles.backBtn} />
      </View>

      {/* ===== 进度条 ===== */}
      <View style={styles.progressContainer}>
        <View style={styles.progressBg}>
          <View style={[styles.progressFill, { width: `${(progress / total) * 100}%` }]} />
        </View>
        <Text style={styles.progressText}>{Math.min(progress + 1, total)} / {total}</Text>
      </View>

      {/* ===== 阶段标识 ===== */}
      <View style={styles.stageIndicator}>
        <View style={[styles.stageDot, isWordStage && styles.stageDotActive]}>
          <Text style={[styles.stageDotText, isWordStage && styles.stageDotTextActive]}>单词</Text>
        </View>
        <View style={styles.stageArrow}>
          <Feather name="arrow-right" size={14} color="rgba(255,255,255,0.35)" />
        </View>
        <View style={[styles.stageDot, !isWordStage && styles.stageDotActive]}>
          <Text style={[styles.stageDotText, !isWordStage && styles.stageDotTextActive]}>例句</Text>
        </View>
      </View>

      {/* ===== 弹性区域：中央卡片（固定位置，无音量波形条） ===== */}
      <View style={styles.cardArea}>
        <Animated.View
          style={[
            styles.card,
            { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
          ]}
        >
          {/* ---- 单词内容（阶段一）---- */}
          {isWordStage && (
            <Animated.View style={{ opacity: contentFadeAnim, width: '100%', alignItems: 'center' }} key={`word-${current?.id}`}>
              <View style={styles.wordContainer}>
                {(() => {
                  // 按空格分割成单词，确保单词不被切断
                  const words = current?.word.split(' ') || [];
                  let charIndex = 0;
                  return words.map((word, wordIndex) => {
                    const wordChars = word.split('');
                    const charElements = wordChars.map((char, index) => {
                      const globalIndex = charIndex + index;
                      const isHighlighted = globalIndex < highlightProgress;
                      return (
                        <Text 
                          key={`${wordIndex}-${index}`}
                          style={[
                            styles.wordChar,
                            isHighlighted ? styles.wordCharHighlighted : styles.wordCharDim
                          ]}
                        >
                          {char}
                        </Text>
                      );
                    });
                    charIndex += word.length;
                    // 将每个单词包裹在一个View中，确保单词不会被切断
                    return (
                      <View key={`word-${wordIndex}`} style={styles.wordWrapper}>
                        {charElements}
                        {/* 在单词后添加空格（最后一个单词除外） */}
                        {wordIndex < words.length - 1 && (
                          <Text style={styles.wordSpace}> </Text>
                        )}
                      </View>
                    );
                  });
                })()}
              </View>
              <Text style={styles.transText}>{current?.translation}</Text>
              {wordScoreLabel !== null && (
                <View style={styles.scoreBadgeContainer}>
                  <View style={styles.scoreBadge}>
                    <Text style={styles.scoreBadgeText}>单词 {wordScoreLabel} 分</Text>
                  </View>
                </View>
              )}
            </Animated.View>
          )}

          {/* ---- 例句内容（阶段二）---- */}
          {!isWordStage && sentence && (
            <Animated.View style={{ opacity: contentFadeAnim, width: '100%', alignItems: 'center' }} key={`sentence-${current?.id}`}>
              {/* 动态字号：句子超过50字符时使用小号字体 */}
              {(() => {
                const isLongSentence = sentence.length > 50;
                const sentenceStyle = isLongSentence ? styles.sentenceContainerLong : styles.sentenceContainer;
                const wordStyle = isLongSentence ? styles.sentenceWordLong : styles.sentenceWord;
                const spaceStyle = isLongSentence ? styles.sentenceSpaceLong : styles.sentenceSpace;
                const highlightedStyle = isLongSentence ? styles.sentenceWordHighlightedLong : styles.sentenceWordHighlighted;
                const dimStyle = isLongSentence ? styles.sentenceWordDimLong : styles.sentenceWordDim;
                const charHighlightedStyle = isLongSentence ? styles.sentenceCharHighlightedLong : styles.sentenceCharHighlighted;
                const charDimStyle = isLongSentence ? styles.sentenceCharDimLong : styles.sentenceCharDim;
                
                return (
                  <View style={sentenceStyle}>
                    {sentence.split(/(\s+)/).map((part, index) => {
                      if (part.match(/^\s+$/)) {
                        return <Text key={index} style={spaceStyle}>{part}</Text>;
                      }
                      const words = sentence.split(/\s+/).filter(w => w.length > 0);
                      const wordIndex = words.indexOf(part);
                      const isCompletedWord = wordIndex < highlightProgress;
                      const isCurrentWord = wordIndex === highlightProgress && currentWordCharProgress > 0;
                      
                      return (
                        <Text key={index} style={wordStyle}>
                          {isCompletedWord ? (
                            <Text style={highlightedStyle}>{part}</Text>
                          ) : isCurrentWord ? (
                            part.split('').map((char, charIndex) => (
                              <Text 
                                key={charIndex}
                                style={charIndex < currentWordCharProgress ? charHighlightedStyle : charDimStyle}
                              >
                                {char}
                              </Text>
                            ))
                          ) : (
                            <Text style={dimStyle}>{part}</Text>
                          )}
                        </Text>
                      );
                    })}
                  </View>
                );
              })()}
              <Text style={styles.sentenceTransText}>{current?.phrases?.[0]?.c}</Text>
              {sentenceScoreLabel !== null && (
                <View style={styles.scoreBadgeContainer}>
                  <View style={styles.scoreBadge}>
                    <Text style={styles.scoreBadgeText}>例句 {sentenceScoreLabel} 分</Text>
                  </View>
                </View>
              )}
            </Animated.View>
          )}

          {/* ---- 发音按钮 ---- */}
          <TouchableOpacity style={styles.soundBtn} onPress={handlePlaySound}>
            <Feather name="volume-2" size={28} color={ANCHOR} />
            <Text style={styles.soundBtnText}>听{isWordStage ? '单词' : '例句'}音</Text>
          </TouchableOpacity>

          {/* ---- 分数覆盖层 ---- */}
          {showScoreOverlay && feedback && (
            <View style={styles.scoreOverlay}>
              <Text style={[styles.scoreBig, { color: feedback.color }]}>{score}</Text>
              <Text style={[styles.scoreLevel, { color: feedback.color }]}>{feedback.level}</Text>
              <Text style={styles.scoreFeedback}>{feedback.feedback}</Text>
              {phase === 'sentence_transition_pause' && (
                <Text style={styles.transitionHint}>即将练习例句...</Text>
              )}
            </View>
          )}

         {/* ---- Toast 提示（温和版）---- */}
         {phase === 'empty_audio_toast' && (
           <View style={styles.toastOverlay}>
             <View style={styles.toastBox}>
               <Feather name="volume-x" size={28} color="#FF9500" />
               <Text style={styles.toastText}>未检测到声音，请再试一次</Text>
             </View>
           </View>
         )}
          {phase === 'volume_low_toast' && (
            <View style={styles.toastOverlay}>
              <View style={styles.toastBox}>
                <Feather name="mic-off" size={28} color="#FF9500" />
                <Text style={styles.toastText}>请放大声音</Text>
                <Text style={styles.toastSubText}>靠近麦克风，大声读出来吧</Text>
              </View>
            </View>
          )}
          {phase === 'too_short_toast' && (
            <View style={styles.toastOverlay}>
              <View style={styles.toastBox}>
                <Feather name="zap" size={28} color="#FF9500" />
                <Text style={styles.toastText}>录音时间太短</Text>
                <Text style={styles.toastSubText}>请按住麦克风按钮并说话</Text>
              </View>
            </View>
          )}
          {phase === 'permission_denied_toast' && (
            <View style={styles.toastOverlay}>
              <View style={styles.toastBox}>
                <Feather name="mic-off" size={36} color="#FF3B30" />
                <Text style={styles.toastText}>麦克风权限未开启</Text>
                <Text style={styles.toastSubText}>请前往「设置」→「隐私」→「麦克风」中开启权限</Text>
              </View>
            </View>
          )}

          {/* ---- AI 评分中 ---- */}
          {phase === 'scoring' && (
            <View style={styles.scoringOverlay}>
              <Feather name="headphones" size={48} color={ANCHOR} />
              <View style={styles.dotRow}>
                {[0, 1, 2].map((i) => {
                  const dotAnim = pulseAnim.interpolate({
                    inputRange: [i * 0.25, i * 0.25 + 0.3, 1],
                    outputRange: [0.4, 1, 0.4],
                    extrapolate: 'clamp',
                  });
                  return (
                    <Animated.View key={i} style={[styles.bouncingDot, { opacity: dotAnim }]} />
                  );
                })}
              </View>
            </View>
          )}
        </Animated.View>
      </View>

      {/* ===== 底部操作区（固定高度，悬浮在 Tab 栏上方） ===== */}
      <View style={[styles.bottomSection, { paddingBottom: Math.max(insets.bottom, 8) }]}>
        {showBottomActionButton ? (
          <View style={styles.recordFixedRow}>
            <TouchableOpacity
              style={styles.nextBtn}
              onPress={phase === 'result_complete' ? finalizeToSummary : handleNextCard}
            >
              <Text style={styles.nextBtnText}>
                {phase === 'result_complete' ? '查看成绩' : '下一题'}
              </Text>
              <Feather name="chevron-right" size={20} color="#fff" />
            </TouchableOpacity>
          </View>
        ) : phase === 'empty_audio_toast' ||
          phase === 'volume_low_toast' ||
          phase === 'too_short_toast' ||
          phase === 'sentence_transition_pause' ? (
          <View style={styles.recordFixedRow}>
            <View style={styles.recordBtnContainer}>
              <View style={styles.recordBtnDisabled}>
                <Feather name="mic" size={36} color="rgba(255,255,255,0.4)" />
              </View>
            </View>
            <Text style={styles.recordHint}>{hintText}</Text>
          </View>
        ) : phase === 'network_error' ? (
          <View style={styles.networkErrorSection}>
            <View style={styles.networkErrorContent}>
              <Feather name="wifi-off" size={28} color="#FF9500" />
              <Text style={styles.networkErrorTitle}>网络有点拥挤，请稍后再试</Text>
            </View>
            <TouchableOpacity style={styles.retryBtn} onPress={handleRetryScoring} activeOpacity={0.7}>
              <Feather name="refresh-cw" size={18} color="#fff" />
              <Text style={styles.retryBtnText}>重新评分</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.reRecordBtn} onPress={handleReRecord} activeOpacity={0.7}>
              <Feather name="mic" size={18} color="#fff" />
              <Text style={styles.reRecordBtnText}>重新录制</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.retryBackBtn} onPress={() => setPhase('ready')} activeOpacity={0.7}>
              <Text style={styles.retryBackBtnText}>取消，返回</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.recordFixedRow}>
            {isRecordingDisabled ? (
              <View style={styles.recordBtnContainer}>
                <View style={styles.recordBtnDisabled}>
                  <Feather name="mic" size={36} color="rgba(255,255,255,0.4)" />
                </View>
              </View>
            ) : (
              <View style={styles.recordBtnContainer}>
                <TouchableOpacity
                  style={styles.recordBtnTouchable}
                  onPressIn={handleRecordStart}
                  onPressOut={handleRecordEnd}
                  activeOpacity={1}
                >
                  {phase === 'recording' ? (
                    <View style={styles.waveformInner}>
                      {/* 增益警告：波形几乎不动时显示 */}
                      {gainWarning && (
                        <View style={styles.gainWarningBadge}>
                          <Text style={styles.gainWarningText}>请放大声音</Text>
                        </View>
                      )}
                      <View style={styles.waveform}>
                        {audioLevels.map((level, index) => {
                          // 根据音量水平改变波形条颜色
                          const barColor = level > 0.6 ? '#fff' :
                                           level > 0.3 ? 'rgba(255,255,255,0.8)' :
                                           'rgba(255,255,255,0.5)';
                          return (
                            <View
                              key={index}
                              style={[
                                styles.waveformBar,
                                {
                                  height: Math.max(3, level * 42),
                                  opacity: 0.5 + level * 0.5,
                                  backgroundColor: barColor,
                                },
                              ]}
                            />
                          );
                        })}
                      </View>
                      {/* 音量指示条 */}
                      <View style={styles.volumeIndicator}>
                        <View
                          style={[
                            styles.volumeFill,
                            {
                              width: `${Math.max(5, normalizedVolume * 100)}%`,
                              backgroundColor: normalizedVolume > 0.5 ? '#34C759' :
                                               normalizedVolume > 0.2 ? '#FFD93D' : '#FF6B6B'
                            }
                          ]}
                        />
                      </View>
                    </View>
                  ) : (
                    <View style={styles.recordBtn}>
                      <Feather name="mic" size={36} color="#fff" />
                    </View>
                  )}
                </TouchableOpacity>
              </View>
            )}
            <Text style={styles.recordHint}>{hintText}</Text>

            {showSkip && (
              <TouchableOpacity
                style={styles.skipBtn}
                onPress={handleSkip}
                activeOpacity={0.7}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Text style={styles.skipBtnText}>跳过</Text>
                <Feather name="chevron-right" size={14} color="#FF4D4F" />
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>

      {/* 成就解锁弹窗 */}
      <AchievementUnlockModal
        isVisible={showAchievementModal}
        badgeId={unlockedBadgeId}
        onClose={() => setShowAchievementModal(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a1a' },

  // 顶部
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 12,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  topTitle: { fontSize: 18, fontWeight: '700', color: '#fff' },

  // 进度条
  progressContainer: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 24, marginBottom: 8, gap: 12,
  },
  progressBg: { flex: 1, height: 6, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: ANCHOR, borderRadius: 3 },
  progressText: { fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.6)' },

  // 阶段标识
  stageIndicator: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 24, marginBottom: 16, gap: 8,
  },
  stageDot: {
    paddingHorizontal: 14, paddingVertical: 4, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  stageDotActive: { backgroundColor: ANCHOR },
  stageDotText: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.4)' },
  stageDotTextActive: { color: '#fff' },
  stageArrow: { alignItems: 'center', justifyContent: 'center' },

  // 中央卡片（固定 padding，无动态组件）
  cardArea: { flex: 1, paddingHorizontal: 24, paddingBottom: 8, marginTop: 20 },
  card: {
    flex: 1, backgroundColor: '#2a2a2a', borderRadius: 24,
    paddingVertical: 30, paddingHorizontal: 28, 
    flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 12, elevation: 8,
    maxHeight: 520,
    gap: 20,
  },

  // ---- 单词（高亮版）----
  wordContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    maxWidth: '90%',
    gap: 2,
  },
  wordWrapper: {
    flexDirection: 'row',
    flexShrink: 0,
  },
  wordChar: {
    fontSize: 32,
    fontWeight: 'bold',
    letterSpacing: 1,
    lineHeight: 44,
    flexShrink: 0,
    transitionProperty: 'color',
    transitionDuration: '50ms',
    transitionTimingFunction: 'ease-out',
  },
  wordSpace: {
    fontSize: 32,
    fontWeight: 'bold',
    lineHeight: 44,
    flexShrink: 0,
  },
  wordCharHighlighted: {
    color: '#fff',
  },
  wordCharDim: {
    color: 'rgba(255,255,255,0.3)',
  },
  // ---- 例句（高亮版）----
  sentenceContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    maxWidth: '90%',
  },
  sentenceWord: {
    fontSize: 24,
    fontWeight: 'bold',
    lineHeight: 34,
    textAlign: 'center',
  },
  sentenceWordHighlighted: {
    color: '#fff',
  },
  sentenceWordDim: {
    color: 'rgba(255,255,255,0.3)',
  },
  sentenceCharHighlighted: {
    color: '#fff',
    transitionProperty: 'color',
    transitionDuration: '50ms',
    transitionTimingFunction: 'ease-out',
  },
  sentenceCharDim: {
    color: 'rgba(255,255,255,0.5)', // 比单词未高亮时亮一些
    transitionProperty: 'color',
    transitionDuration: '50ms',
    transitionTimingFunction: 'ease-out',
  },
  sentenceSpace: {
    fontSize: 24,
    lineHeight: 34,
  },
  // ---- 长例句样式（超过50字符时使用）----
  sentenceContainerLong: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    maxWidth: '90%',
  },
  sentenceWordLong: {
    fontSize: 20,
    fontWeight: 'bold',
    lineHeight: 28,
    textAlign: 'center',
  },
  sentenceWordHighlightedLong: {
    color: '#fff',
  },
  sentenceWordDimLong: {
    color: 'rgba(255,255,255,0.3)',
  },
  sentenceCharHighlightedLong: {
    color: '#fff',
    transitionProperty: 'color',
    transitionDuration: '50ms',
    transitionTimingFunction: 'ease-out',
  },
  sentenceCharDimLong: {
    color: 'rgba(255,255,255,0.5)',
    transitionProperty: 'color',
    transitionDuration: '50ms',
    transitionTimingFunction: 'ease-out',
  },
  sentenceSpaceLong: {
    fontSize: 20,
    lineHeight: 28,
  },
  transText: {
    fontSize: 28, fontWeight: '600', color: 'rgba(255,107,107,0.85)',
    textAlign: 'center',
  },
  sentenceTransText: {
    fontSize: 20, fontWeight: '600', color: 'rgba(255,107,107,0.85)',
    textAlign: 'center',
  },

  // 得分标注
  scoreBadgeContainer: { alignItems: 'center' },
  scoreBadge: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 3,
  },
  scoreBadgeText: { fontSize: 13, fontWeight: '700', color: '#ccc' },

  // 发音按钮
  soundBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,107,107,0.12)',
    borderRadius: 14, paddingHorizontal: 20, paddingVertical: 12, gap: 8,
    minHeight: 48,
  },
  soundBtnText: { color: ANCHOR, fontSize: 16, fontWeight: '600' },

  // Toast
  toastOverlay: {
    position: 'absolute', inset: 0,
    backgroundColor: 'rgba(42,42,42,0.92)', borderRadius: 24,
    alignItems: 'center', justifyContent: 'center',
  },
  toastBox: { alignItems: 'center', gap: 8 },
  toastText: { fontSize: 22, fontWeight: '800', color: '#FF9500' },
  toastSubText: { fontSize: 16, fontWeight: '500', color: 'rgba(255,255,255,0.7)' },

  // 评分覆盖
  scoreOverlay: {
    position: 'absolute', inset: 0,
    backgroundColor: 'rgba(42,42,42,0.92)', borderRadius: 24,
    alignItems: 'center', justifyContent: 'center',
  },
  scoreBig: { fontSize: 72, fontWeight: '900', marginBottom: 4 },
  scoreLevel: { fontSize: 24, fontWeight: '700', marginBottom: 8 },
  scoreFeedback: { fontSize: 16, color: 'rgba(255,255,255,0.8)', textAlign: 'center', paddingHorizontal: 24 },
  transitionHint: { fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.6)', marginTop: 16 },

  // 评分中
  scoringOverlay: {
    position: 'absolute', inset: 0,
    backgroundColor: 'rgba(42,42,42,0.92)', borderRadius: 24,
    alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  scoringText: { fontSize: 20, fontWeight: '700', color: '#fff' },
  dotRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  bouncingDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: ANCHOR },

  // 底部操作区
  bottomSection: {
    alignItems: 'center', paddingHorizontal: 24, paddingTop: 8, paddingBottom: 20,
    backgroundColor: 'rgba(26,26,26,0.95)',
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)',
  },
  recordFixedRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    width: '100%', height: 120, position: 'relative',
  },
  recordBtnContainer: { 
    width: 80, height: 80, 
    alignItems: 'center', justifyContent: 'center',
    position: 'absolute', top: 0,
  },
  recordBtn: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: ANCHOR, alignItems: 'center', justifyContent: 'center',
    shadowColor: ANCHOR, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 12, elevation: 8,
  },
  recordBtnActive: { backgroundColor: '#FF3B30' },
  recordBtnDisabled: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  recordHint: {
    fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.5)',
    position: 'absolute', bottom: 4,
  },
  
  // 录音波形动画
  waveformContainer: {
    width: 80, height: 80,
    alignItems: 'center', justifyContent: 'center',
    position: 'absolute', top: 0,
  },
  waveformInner: {
    width: 80, height: 80,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: 40,
    backgroundColor: ANCHOR,
    shadowColor: ANCHOR, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 12, elevation: 8,
  },
  waveform: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    width: '100%',
    height: 40,
  },
  waveformBar: {
    width: 3,
    backgroundColor: '#fff',
    borderRadius: 2,
  },

  // 增益警告徽章
  gainWarningBadge: {
    position: 'absolute',
    top: 4,
    backgroundColor: 'rgba(255,149,0,0.85)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
    zIndex: 10,
  },
  gainWarningText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
  },

  // 音量指示条
  volumeIndicator: {
    position: 'absolute',
    bottom: 6,
    left: 10,
    right: 10,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  volumeFill: {
    height: '100%',
    borderRadius: 2,
  },

  recordBtnTouchable: {
    width: 80, height: 80,
    alignItems: 'center', justifyContent: 'center',
  },

  // 跳过按钮
  skipBtn: {
    position: 'absolute', right: 4, bottom: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 4, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10,
    backgroundColor: 'rgba(255,77,79,0.08)',
    borderWidth: 1, borderColor: 'rgba(255,77,79,0.25)',
  },
  skipBtnText: { fontSize: 14, fontWeight: '700', color: '#FF4D4F' },

  // 网络错误
  networkErrorSection: { alignItems: 'center', gap: 14, width: '100%' },
  networkErrorContent: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(255,149,0,0.12)',
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12,
  },
  networkErrorTitle: { fontSize: 15, fontWeight: '600', color: '#FF9500', flexShrink: 1 },
  retryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: ANCHOR, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 32, gap: 8,
    width: '100%',
  },
  retryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  reRecordBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#34C759', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 32, gap: 8,
    width: '100%',
  },
  reRecordBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  retryBackBtn: { paddingVertical: 6 },
  retryBackBtnText: { fontSize: 14, fontWeight: '500', color: 'rgba(255,255,255,0.4)' },

  // "下一题"按钮
  nextBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: ANCHOR, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 40, gap: 8,
    width: '100%',
  },
  nextBtnText: { color: '#fff', fontSize: 18, fontWeight: '700' },

  // 空状态
  centerContent: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  emptyTitle: { fontSize: 22, fontWeight: '700', color: '#fff', marginTop: 20, marginBottom: 8 },
  emptySub: { fontSize: 15, color: 'rgba(255,255,255,0.5)', textAlign: 'center', lineHeight: 22, marginBottom: 28 },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: ANCHOR, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 28, gap: 8,
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  // 勋章
  badgeContainer: { alignItems: 'center', gap: 12 },
  badgeEmoji: { fontSize: 80 },
  badgeTitle: { fontSize: 24, fontWeight: '800', color: '#fff', textAlign: 'center' },
  badgeSub: { fontSize: 15, color: 'rgba(255,255,255,0.6)', textAlign: 'center', marginBottom: 12 },
});
