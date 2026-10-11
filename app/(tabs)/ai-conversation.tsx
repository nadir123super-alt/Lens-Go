/**
 * AI 实时口语通话模块 (Step 2 & 3 — 腾讯云 ASR + 智谱 GLM-4-Flash + Edge TTS 闭环)
 *
 * 功能：
 * - 沉浸式深色通话界面
 * - 状态机管理：idle → speaking(开场白) → listening → thinking → speaking(AI回复)
 * - 1分钟无声自动挂断计时器
 * - 手动挂断按钮
 * - 实时音量波形动画（绑定真实麦克风音量）
 * - VAD 静音检测自动断句（1.5~2秒静音触发）
 * - 状态锁：thinking/speaking 时阻断 VAD
 * - 腾讯云 ASR 语音转写（STT），回退讯飞 IAT
 * - 智谱 GLM-4-Flash LLM 中英混说智能纠错（免费模型）
 * - Edge TTS 播放 AI 回复（带情感/语调），onDone 回调自动重启录音
 * - 防回音状态锁：TTS 播放期间完全阻断麦克风和 VAD
 * - 通话历史记录功能
 */
import { Feather } from '@expo/vector-icons';
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  Easing,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AchievementUnlockModal from '../../components/AchievementUnlockModal';
import { useGlobalSpeech } from '../../hooks/useGlobalSpeech';
import { checkOralAchievements } from '../../services/achievementService';
import { ConversationMessage, getAiReply, transcribeAudio } from '../../services/aiConversationService';
import { saveOralSession } from '../../services/oralHistoryService';
import { setAiConversationRate } from '../../services/speechSettingsService';
import { logStudyDate } from '../../services/studyStatsService';
type CallStatus = 'idle' | 'listening' | 'thinking' | 'speaking';

interface Message {
  role: 'ai' | 'user';
  text: string;
}

// ====== 开场白库（互动式、多样化） ======
// 包含日常问候、心情询问、角色扮演提议、趣味游戏等
const OPENING_LINES = [
  // --- 日常互动 ---
  "Hey! What are you doing right now? I'd love to hear about it.",
  "Hi there! How was your day today? Anything exciting happen?",
  "Hello! How are you feeling at this moment? Happy, tired, or something else?",
  "Hey! What have you been up to lately? Any new hobbies or adventures?",
  "Hi! Tell me about something that made you smile today.",
  "Hello! What's on your mind right now? Let's chat about it.",
  "Hey! I'm curious — what's the most interesting thing that happened to you this week?",
  "Hi! How's your mood today? I'm here to listen and chat.",
  "Hey! What are you working on or studying these days?",
  "Hello! Let's start with a simple question — how are you, really?",

  // --- 角色扮演提议 ---
  "Hey! Want to try a role-play? Imagine you're ordering coffee at a cafe in New York. I'll be the barista!",
  "Hi! How about a fun role-play? Let's pretend you're checking into a hotel in London, and I'm the receptionist.",
  "Hello! Feeling adventurous? Let's do a role-play — you're at a restaurant in Paris ordering dinner, and I'm the waiter.",
  "Hey! Let's try something fun — imagine you're at an airport asking for directions, and I'm the information desk staff.",
  "Hi! Want to practice a real-life scenario? Let's pretend you're at a job interview, and I'm the hiring manager.",
  "Hey! How about a role-play? You're shopping at a mall in Sydney, and I'm the shop assistant. Ready?",
  "Hi! Let's do a role-play — you're at a doctor's appointment in the US, and I'm the doctor. What seems to be the problem?",
  "Hello! Want to try a role-play? Imagine you're making a new friend at a party in New York. I'll start — 'Hi, I'm Luna! This is such a great party, isn't it?'",

  // --- 唱歌挑战 ---
  "Hey! Wanna try something fun? How about singing a few lines from your favorite English song? I'll join in!",
  "Hi! Let's do a karaoke moment! Pick any English song and sing a couple of lines. I'll sing along with you!",

  // --- 猜词游戏 ---
  "Hey! Let's play a word guessing game! I'll describe something in English, and you try to guess what it is. Ready?",
  "Hi! Wanna play a fun game? I'll give you clues about a word, and you guess it. Let's start with an easy one!",

  // --- 20个问题 ---
  "Hey! Let's play 20 questions! I'm thinking of something, and you ask me yes-or-no questions to figure out what it is. Go ahead, ask away!",
  "Hi! How about a guessing game? I've got something in mind — you've got 20 yes-or-no questions to figure it out. What's your first question?",

  // --- 故事接龙 ---
  "Hey! Let's create a story together! I'll start: 'Once upon a time, in a tiny village hidden between two mountains...' Now you continue!",
  "Hi! Wanna make up a crazy story? I'll begin: 'I woke up this morning and realized I could talk to animals...' Your turn, what happens next?",

  // --- 电影台词模仿 ---
  "Hey! Let's do movie quotes! I'll say a famous line from a movie, and you try to say the next line. Ready? 'I'll be back...'",
  "Hi! Wanna play movie quotes? I'll start with a classic: 'May the Force be with you.' Now you say something back!",

  // --- 笑话时间 ---
  "Hey! Let's share some jokes! I'll tell you a funny one: 'Why don't scientists trust atoms? Because they make up everything!' Got any jokes to share?",
  "Hi! Wanna hear a joke? 'What do you call a bear with no teeth? A gummy bear!' Okay your turn — tell me a funny one in English!",

  // --- 绕口令挑战 ---
  "Hey! Can you say this tongue twister? 'She sells seashells by the seashore.' Try it! Let's see how fast you can say it!",
  "Hi! Let's try a tongue twister challenge! Repeat after me: 'How much wood would a woodchuck chuck if a woodchuck could chuck wood?' Your turn!",

  // --- 魔法咒语 ---
  "Hey! Let's pretend we're in a wizard school! I'll teach you a magic spell in English. Repeat after me: 'Lumos!' — that's the spell to light up your wand!",
  "Hi! Wanna be a wizard for a bit? I'm Professor Luna! Today's spell is 'Wingardium Leviosa' — try saying it!",
];

function getRandomOpening(): string {
  return OPENING_LINES[Math.floor(Math.random() * OPENING_LINES.length)];
}

// ====== 常量 ======
const INACTIVITY_TIMEOUT_MS = 60_000; // 1 分钟
// ★ 降低 VAD 阈值从 -50 到 -55 dBFS，提高对微弱声音的敏感度
// 让更轻柔的说话声也能被检测到，避免因音量略低而被误判为静音
const VAD_SILENCE_THRESHOLD_DB = -55; // 静音阈值 (dBFS)，高于此值视为有人说话
const VAD_SILENCE_TIMEOUT_MS = 1800;  // 静音持续 1.8 秒触发断句
const METERING_INTERVAL_MS = 150;     // 音量采样间隔 150ms
const WAVEFORM_BARS = 32;             // 波形条数量

// expo-av 录音配置（与 recordingService 保持一致）
const RECORDING_OPTIONS: Audio.RecordingOptions = {
  android: {
    extension: '.3gp',
    outputFormat: Audio.AndroidOutputFormat.THREE_GPP,
    audioEncoder: Audio.AndroidAudioEncoder.AMR_NB,
    // ★ 从 8000Hz 提升到 16000Hz，与 recordingService 保持一致
    // 更高的采样率提供更丰富的音频细节，有助于 ASR 识别
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 128000,
  },
  ios: {
    extension: '.wav',
    audioQuality: Audio.IOSAudioQuality.HIGH,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 256000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: 'audio/webm',
    bitsPerSecond: 128000,
  },
  // 关键：启用音量计量！
  isMeteringEnabled: true,
};

// ====== 主页面 ======
export default function AIConversationScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  // ── 状态 ──
  const [isActive, setIsActive] = useState(false);
  const [status, setStatus] = useState<CallStatus>('idle');
  // 同步 status 到 ref，供 interval/setTimeout 回调读取最新值
  const setStatusAndRef = useCallback((newStatus: CallStatus) => {
    setStatus(newStatus);
    statusRef.current = newStatus;
  }, []);
  const [messages, setMessages] = useState<Message[]>([]);
  const [aiText, setAiText] = useState('');
  // 逐字呈现：根据 TTS 朗读进度显示 aiText 的一部分
  const [displayedText, setDisplayedText] = useState('');
  const [audioLevels, setAudioLevels] = useState<number[]>(new Array(WAVEFORM_BARS).fill(0));
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [achievementModalVisible, setAchievementModalVisible] = useState(false);
  const [newlyUnlockedBadgeId, setNewlyUnlockedBadgeId] = useState<string>('');

  // ── 动画 ──
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const breathingAnim = useRef(new Animated.Value(1)).current;
  const scrollViewRef = useRef<ScrollView>(null);

  // 思考动效 - 三个点上下跳动
  const dot1Anim = useRef(new Animated.Value(0)).current;
  const dot2Anim = useRef(new Animated.Value(0)).current;
  const dot3Anim = useRef(new Animated.Value(0)).current;

  // ── 录音相关 ref ──
  const recordingRef = useRef<Audio.Recording | null>(null);
  const audioUriRef = useRef<string | null>(null);
  const meteringTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isRecordingRef = useRef(false);

  // ── 计时器 ref ──
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  // ── 状态锁 ref（防止 VAD 在 thinking/speaking 时误触发） ──
  const vadLockedRef = useRef(false);
  // ── 状态 ref（避免闭包陷阱，供 interval 回调读取最新状态） ──
  const statusRef = useRef<CallStatus>('idle');

  // ── 对话历史（用于 LLM 上下文） ──
  const conversationHistoryRef = useRef<ConversationMessage[]>([]);
  const callStartTimeRef = useRef(0);
  const totalCallDurationRef = useRef(0);
  const callDurationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const endCallRef = useRef<(() => void) | null>(null);

  // ── 通话结束标记：防止 onSilenceTimeout 异步流程在 endCall 后继续执行 ──
  const callEndedRef = useRef(false);

  // ── 通话进行中标记（同步 isActive，供 useFocusEffect / AppState 回调读取最新值） ──
  const isActiveRef = useRef(false);

  // ====== 全局 TTS 发音管理器 ======
  const { speak: globalSpeak, stop: stopGlobalSpeech } = useGlobalSpeech();

  // ====== 清理 ======
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      clearInactivityTimer();
      cleanupRecording();
      stopGlobalSpeech();
    };
  }, [stopGlobalSpeech]);

  // ★ 页面失去焦点时（切换到其他 Tab / 离开通话页面）立即结束通话
  // 需求：只有停留在通话页面时才保持通话，离开页面必须自动挂断
  useFocusEffect(
    useCallback(() => {
      return () => {
        console.log('[ai-conversation] 🚫 页面失去焦点，自动结束通话');
        // 先停止音频播放（立即静音）
        stopGlobalSpeech();
        // 若通话进行中，则完整走一遍挂断流程（停止录音、清理计时器、保存记录）
        if (isActiveRef.current) {
          endCallRef.current?.();
        }
      };
    }, [stopGlobalSpeech])
  );

  // ★ App 进入后台 / 非活跃状态时自动挂断通话
  // 需求：App 处于后台时也要自动挂断，只有停留在通话页面才保持通话
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      // 'active' 表示 App 在前台；'background' / 'inactive' 表示离开前台
      if (nextState !== 'active' && isActiveRef.current) {
        console.log('[ai-conversation] 📴 App 进入后台，自动结束通话');
        stopGlobalSpeech();
        endCallRef.current?.();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [stopGlobalSpeech]);

  // ====== 呼吸动画（idle 状态） ======
  useEffect(() => {
    if (status === 'idle') {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(breathingAnim, {
            toValue: 0.6,
            duration: 1500,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(breathingAnim, {
            toValue: 1,
            duration: 1500,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      );
      loop.start();
      return () => loop.stop();
    } else {
      breathingAnim.setValue(1);
    }
  }, [status, breathingAnim]);

  // ====== 脉冲动画（listening / speaking 状态） ======
  useEffect(() => {
    if (status === 'listening' || status === 'speaking') {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.15,
            duration: 600,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 600,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      );
      loop.start();
      return () => loop.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [status, pulseAnim]);

  // ====== 思考动效（三个点上下跳动） ======
  useEffect(() => {
    if (status === 'thinking') {
      // 三个点依次上下跳动
      const animateDots = () => {
        Animated.sequence([
          Animated.timing(dot1Anim, { toValue: -12, duration: 200, useNativeDriver: true }),
          Animated.timing(dot1Anim, { toValue: 0, duration: 200, useNativeDriver: true }),
        ]).start();

        setTimeout(() => {
          Animated.sequence([
            Animated.timing(dot2Anim, { toValue: -12, duration: 200, useNativeDriver: true }),
            Animated.timing(dot2Anim, { toValue: 0, duration: 200, useNativeDriver: true }),
          ]).start();
        }, 100);

        setTimeout(() => {
          Animated.sequence([
            Animated.timing(dot3Anim, { toValue: -12, duration: 200, useNativeDriver: true }),
            Animated.timing(dot3Anim, { toValue: 0, duration: 200, useNativeDriver: true }),
          ]).start();
        }, 200);
      };

      animateDots();
      const interval = setInterval(animateDots, 600);

      return () => clearInterval(interval);
    } else {
      // 重置位置
      dot1Anim.setValue(0);
      dot2Anim.setValue(0);
      dot3Anim.setValue(0);
    }
  }, [status, dot1Anim, dot2Anim, dot3Anim]);

  // ====== 计时器管理 ======
  const clearInactivityTimer = useCallback(() => {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }
  }, []);

  const resetInactivityTimer = useCallback(() => {
    clearInactivityTimer();
    if (!isActive) return;
    inactivityTimerRef.current = setTimeout(() => {
      if (!isMountedRef.current) return;
      // 【防竞态】如果通话已结束，不再触发自动挂断
      if (callEndedRef.current) return;
      console.log('[AIConversation] 1分钟无活动，自动挂断');
      endCallRef.current?.();
    }, INACTIVITY_TIMEOUT_MS);
  }, [isActive]);

  // ====== 录音清理 ======
  const cleanupRecording = useCallback(async () => {
    // 清除静音计时器
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    // 停止 metering 轮询
    if (meteringTimerRef.current) {
      clearInterval(meteringTimerRef.current);
      meteringTimerRef.current = null;
    }
    // 停止并卸载录音
    try {
      if (recordingRef.current) {
        const status = await recordingRef.current.getStatusAsync();
        if (status.isRecording) {
          await recordingRef.current.stopAndUnloadAsync();
        }
        // Recording 没有 unloadAsync，stopAndUnloadAsync 已足够
        recordingRef.current = null;
      }
    } catch (e) {
      console.warn('[AIConversation] cleanupRecording 异常:', e);
    }
    isRecordingRef.current = false;
    audioUriRef.current = null;
  }, []);

  // ====== 开始录音 ======
  const startRecording = useCallback(async () => {
    if (isRecordingRef.current) {
      console.log('[AIConversation] 已在录音中，跳过');
      return;
    }

    try {
      // 1. 请求权限
      const { status: permStatus } = await Audio.requestPermissionsAsync();
      if (permStatus !== 'granted') {
        console.warn('[AIConversation] 录音权限未授予');
        return;
      }

      // 2. 设置音频模式（确保启用录音）
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

      // ★ 尝试提高麦克风增益（Android）
      if (Platform.OS === 'android') {
        try {
          const { boostMicrophoneGain } = await import('../../services/recordingService');
          await boostMicrophoneGain();
        } catch (e: any) {
          console.warn('[AIConversation] boostMicrophoneGain 不可用:', e?.message);
        }
      }

      // 3. 创建录音，启用 metering
      const { recording } = await Audio.Recording.createAsync(RECORDING_OPTIONS);
      
      recordingRef.current = recording;
      isRecordingRef.current = true;
      audioUriRef.current = null;

      console.log('[AIConversation] ✅ 录音已启动，metering 已启用');

      // 5. 启动音量轮询（每 150ms 采样一次）
      startMetering(recording);

      // 6. 重置静音计时器（开始监听 VAD）
      resetSilenceTimer();

      // 7. 重置活动计时器
      resetInactivityTimer();
    } catch (err) {
      console.error('[AIConversation] 启动录音失败:', err);
      isRecordingRef.current = false;
    }
  }, [resetInactivityTimer]);

  // ====== 停止录音 ======
  const stopRecording = useCallback(async (): Promise<string | null> => {
    if (!recordingRef.current || !isRecordingRef.current) {
      console.log('[AIConversation] 无活跃录音，跳过停止');
      return null;
    }

    // 停止 metering 轮询
    if (meteringTimerRef.current) {
      clearInterval(meteringTimerRef.current);
      meteringTimerRef.current = null;
    }
    // 清除静音计时器
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    try {
      const recording = recordingRef.current;
      const status = await recording.getStatusAsync();
      if (status.isRecording) {
        await recording.stopAndUnloadAsync();
      }
      const uri = recording.getURI();
      audioUriRef.current = uri;
      recordingRef.current = null;
      isRecordingRef.current = false;

      console.log('[AIConversation] ✅ 录音已停止, URI:', uri);
      return uri;
    } catch (err) {
      console.error('[AIConversation] 停止录音失败:', err);
      recordingRef.current = null;
      isRecordingRef.current = false;
      return null;
    }
  }, []);

  // ====== 音量轮询 ======
  const startMetering = useCallback((recording: Audio.Recording) => {
    if (meteringTimerRef.current) {
      clearInterval(meteringTimerRef.current);
    }

    console.log('[AIConversation] startMetering 已启动');

    meteringTimerRef.current = setInterval(async () => {
      if (!isMountedRef.current) return;
      try {
        const recStatus = await recording.getStatusAsync();
        if (!recStatus.isRecording) {
          console.log('[AIConversation] 录音未在进行中');
          return;
        }
        const metering = (recStatus as any).metering ?? -160;

        // 归一化音量到 0~1 范围（dBFS 范围通常 -160 ~ 0）
        // -160 = 静音, 0 = 最大
        let normalizedVolume = 0;
        if (metering > -160) {
          // 将 dBFS 映射到 0~1：-60dB ~ 0dB 映射到 0~1
          normalizedVolume = Math.min(1, Math.max(0, (metering + 60) / 60));
        }

        // 调试日志
        if (normalizedVolume > 0.1) {
          console.log(`[AIConversation] 检测到声音: metering=${metering}, normalized=${normalizedVolume.toFixed(3)}`);
        }

        // 更新波形数据
        setAudioLevels((prev) => {
          const newLevels = [...prev];
          // 将新音量值推到数组末尾，移除最旧的
          newLevels.push(normalizedVolume);
          newLevels.shift();
          return newLevels;
        });

        // VAD 检测（仅在 listening 状态且未锁定时）
        // 使用 statusRef.current 而非闭包中的 status，避免闭包陷阱
        if (statusRef.current === 'listening' && !vadLockedRef.current) {
          handleVAD(normalizedVolume);
        }
      } catch (error) {
        console.error('[AIConversation] metering 读取失败:', error);
      }
    }, METERING_INTERVAL_MS);
  }, []); // 不再依赖 status，使用 statusRef 读取最新值

  // ====== VAD 静音检测 ======
  const handleVAD = useCallback((normalizedVolume: number) => {
    // 将归一化音量转回 dBFS 近似值用于阈值判断
    // normalizedVolume 0~1 对应 -60dB ~ 0dB
    const volumeDB = normalizedVolume * 60 - 60; // 映射回 -60 ~ 0

    if (volumeDB > VAD_SILENCE_THRESHOLD_DB) {
      // 检测到人声 → 重置静音计时器
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
    } else {
      // 检测到静音 → 启动/维持静音计时器
      if (!silenceTimerRef.current) {
        silenceTimerRef.current = setTimeout(() => {
          if (!isMountedRef.current) return;
          // 静音持续超过阈值 → 触发自动断句
          console.log('[AIConversation] 🔇 静音超时，触发自动断句');
          onSilenceTimeout();
        }, VAD_SILENCE_TIMEOUT_MS);
      }
    }
  }, []);

  // ====== 静音超时回调（自动断句 → STT → LLM → TTS 回复） ======
  const onSilenceTimeout = useCallback(async () => {
    if (vadLockedRef.current) return;
    if (statusRef.current !== 'listening') return;

    // 锁定 VAD，防止重复触发
    vadLockedRef.current = true;

    // 1. 停止录音，获取音频文件路径
    const uri = await stopRecording();
    if (!uri) {
      console.warn('[AIConversation] 断句：未获取到音频 URI');
      vadLockedRef.current = false;
      return;
    }

    console.log('[AIConversation] 📁 音频文件已保存:', uri);

    // 2. 将状态切换为 thinking
    setStatusAndRef('thinking');

    // 3. 重置波形
    setAudioLevels(new Array(WAVEFORM_BARS).fill(0));
    resetInactivityTimer();

    // 4. STT：语音转文字（腾讯云 ASR）
    console.log('[AIConversation] 🎤 开始语音转写（腾讯云 ASR）...');
    const userText = await transcribeAudio(uri);

    // 【防竞态】如果在 STT 过程中用户结束了通话，直接退出
    if (callEndedRef.current) {
      console.log('[AIConversation] ⛔ 通话已结束，跳过本轮回复');
      vadLockedRef.current = false;
      return;
    }

    if (!userText) {
      console.warn('[AIConversation] ⚠️ 语音转写结果为空，跳过本轮');
      // 空音频：直接重启录音
      setStatusAndRef('listening');
      vadLockedRef.current = false;
      startRecording();
      resetInactivityTimer();
      return;
    }

    console.log('[AIConversation] ✅ 转写结果:', userText);

    // 5. 将用户消息添加到对话预览
    setMessages((prev) => [...prev, { role: 'user', text: userText }]);

    // 6. LLM：获取 AI 回复（智谱 GLM-4-Flash）
    console.log('[AIConversation] 🤖 调用智谱 GLM-4-Flash 生成回复...');
    const aiReply = await getAiReply(userText, conversationHistoryRef.current);

    // 【防竞态】如果在 LLM 调用过程中用户结束了通话，直接退出
    if (callEndedRef.current) {
      console.log('[AIConversation] ⛔ 通话已结束，跳过 AI 回复播放');
      vadLockedRef.current = false;
      return;
    }

    console.log('[AIConversation] ✅ AI 回复:', aiReply);

    // 7. 更新对话历史
    conversationHistoryRef.current.push(
      { role: 'user', content: userText },
      { role: 'assistant', content: aiReply }
    );

    // 8. 显示 AI 回复（逐字呈现）
    setAiText(aiReply);
    setDisplayedText(''); // 重置逐字文本，从空开始
    setStatusAndRef('speaking');
    setMessages((prev) => [...prev, { role: 'ai', text: aiReply }]);
    resetInactivityTimer();

    // 9. 防回音状态锁：TTS 播放期间完全阻断麦克风和 VAD
    // vadLockedRef.current 已经为 true，保持锁定

    // 10. 使用全局 TTS 播放 AI 回复，onDone 回调自动重启录音
    // 同时传入 onGlobalCharProgress 回调，实现逐字呈现
    globalSpeak(
      aiReply,
      () => {
        // onDone 回调：TTS 播放完毕
        if (!isMountedRef.current) return;
        // 【防竞态】如果通话已结束，不再重启录音
        if (callEndedRef.current) {
          console.log('[AIConversation] ⛔ 通话已结束，TTS onDone 不重启录音');
          return;
        }

        console.log('[AIConversation] ✅ TTS 播放完毕，重启录音');

        // TTS 完成时，确保显示完整文本
        setDisplayedText(aiReply);

        // 解锁 VAD（防回音状态锁解除）
        vadLockedRef.current = false;
        setStatusAndRef('listening');

        // 重新激活麦克风和 VAD 监听
        startRecording();
        resetInactivityTimer();
      },
      undefined,
      (charIndex: number) => {
        // onGlobalCharProgress：根据 TTS 朗读进度更新逐字文本
        if (!isMountedRef.current) return;
        if (callEndedRef.current) return;
        // 从 aiText 中截取到当前字符位置
        setDisplayedText(aiReply.substring(0, charIndex));
      }
    );
  }, [stopRecording, resetInactivityTimer, startRecording, globalSpeak]);

  // ====== 重置静音计时器 ======
  const resetSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  // ====== 开始通话 ======
  const startCall = useCallback(() => {
    // 重置通话结束标记，允许新的通话流程
    callEndedRef.current = false;
    // 标记通话进行中（供 useFocusEffect / AppState 回调判断）
    isActiveRef.current = true;

    // AI 通话模块使用稍慢的语速（0.9），不影响其他模块
    setAiConversationRate(0.9);

    setIsActive(true);
    setMessages([]);
    setAudioLevels(new Array(WAVEFORM_BARS).fill(0));
    vadLockedRef.current = false;
    conversationHistoryRef.current = [];
    callStartTimeRef.current = Date.now();
    totalCallDurationRef.current = 0;

    // 启动通话时长计数器（每秒 +1）
    if (callDurationTimerRef.current) clearInterval(callDurationTimerRef.current);
    callDurationTimerRef.current = setInterval(() => {
      totalCallDurationRef.current += 1;
    }, 1000);

    // 随机选开场白
    const opening = getRandomOpening();
    setAiText(opening);
    setDisplayedText(''); // 重置逐字文本，从空开始
    setStatusAndRef('speaking');
    setMessages([{ role: 'ai', text: opening }]);

    // 将开场白加入对话历史
    conversationHistoryRef.current.push(
      { role: 'assistant', content: opening }
    );

    // 启动 2 分钟计时器
    resetInactivityTimer();

    // 防回音状态锁：开场白 TTS 播放期间阻断麦克风
    vadLockedRef.current = true;

    // 使用全局 TTS 播放开场白，onDone 回调自动切换到 listening
    // 同时传入 onGlobalCharProgress 回调，实现逐字呈现
    globalSpeak(
      opening,
      () => {
        if (!isMountedRef.current) return;
        // 【防竞态】如果通话已结束（用户在开场白播放期间点击了结束），不再启动录音
        if (callEndedRef.current) {
          console.log('[AIConversation] ⛔ 通话已结束，开场白 onDone 不启动录音');
          return;
        }

        console.log('[AIConversation] ✅ 开场白播放完毕，切换到聆听模式');

        // TTS 完成时，确保显示完整文本
        setDisplayedText(opening);

        // 解锁 VAD（防回音状态锁解除）
        vadLockedRef.current = false;
        setStatusAndRef('listening');

        // 启动录音
        startRecording();
        resetInactivityTimer();
      },
      undefined,
      (charIndex: number) => {
        // onGlobalCharProgress：根据 TTS 朗读进度更新逐字文本
        if (!isMountedRef.current) return;
        if (callEndedRef.current) return;
        setDisplayedText(opening.substring(0, charIndex));
      }
    );
  }, [resetInactivityTimer, startRecording, globalSpeak]);

  // ====== 结束通话 ======
  const endCall = useCallback(() => {
    // 1. 立即标记通话已结束，阻止 onSilenceTimeout 等异步流程继续执行
    callEndedRef.current = true;
    // 标记通话已不在进行中（供 useFocusEffect / AppState 回调判断）
    isActiveRef.current = false;

    // 2. 立即恢复全局语速，不影响其他模块
    setAiConversationRate(null);

    // 3. 立即停止所有计时器（同步操作）
    clearInactivityTimer();
    if (callDurationTimerRef.current) {
      clearInterval(callDurationTimerRef.current);
      callDurationTimerRef.current = null;
    }

    // 4. 立即停止 TTS 播放（同步操作）
    stopGlobalSpeech();

    // 5. 立即重置 UI 状态（同步），让用户看到界面立刻回到 idle
    setIsActive(false);
    setStatusAndRef('idle');
    setAiText('');
    setDisplayedText('');
    setAudioLevels(new Array(WAVEFORM_BARS).fill(0));
    vadLockedRef.current = false;

    // 6. 保存当前对话历史的快照，然后清空（同步）
    const snapshotHistory = [...conversationHistoryRef.current];
    const snapshotStartTime = callStartTimeRef.current;
    const snapshotDuration = totalCallDurationRef.current;
    conversationHistoryRef.current = [];
    callStartTimeRef.current = 0;
    totalCallDurationRef.current = 0;

    // 7. 后台异步保存记录（不阻塞 UI）
    (async () => {
      try {
        // 先清理录音（可能因录音已停止而抛出异常，由外层 try-catch 处理）
        await cleanupRecording();
        const duration = snapshotStartTime > 0 ? Math.floor((Date.now() - snapshotStartTime) / 1000) : 0;
        const userMessages = snapshotHistory
          .filter((m): m is typeof m & { role: 'user' | 'assistant' } => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
        if (userMessages.length > 0) {
          console.log('[AIConversation] 保存对话记录，共', userMessages.length, '条消息');
          await saveOralSession(userMessages, duration);

          // 通话记录保存成功后，触发 AI 通话成就检测
          const newlyUnlocked = await checkOralAchievements();
          if (newlyUnlocked.length > 0 && isMountedRef.current) {
            setNewlyUnlockedBadgeId(newlyUnlocked[0]);
            setAchievementModalVisible(true);
          }
        }

        // 检查是否满足 3 分钟打卡条件
        if (snapshotDuration >= 180) {
          console.log('[AIConversation] 通话时长', snapshotDuration, '秒，满足3分钟打卡条件');
          await logStudyDate('practice');
          if (isMountedRef.current) {
            setToastMessage('🎉 恭喜！今日 AI 通话满 3 分钟，已成功点亮今日学习天数！');
            setTimeout(() => {
              if (isMountedRef.current) setToastMessage(null);
            }, 4000);
          }
        }
      } catch (err) {
        console.error('[AIConversation] endCall 异步保存异常:', err);
      }
    })();
  }, [cleanupRecording, stopGlobalSpeech]);

  // 同步 endCall 到 ref（供 resetInactivityTimer 使用）
  endCallRef.current = endCall;

  // ====== 状态文本 ======
  const getStatusText = (): string => {
    switch (status) {
      case 'idle':
        return '点击下方按钮开始 AI 口语对话';
      case 'listening':
        return 'AI 正在听你说话...';
      case 'thinking':
        return ''; // 思考状态不显示文字，用动效展示
      case 'speaking':
        return 'AI 正在说话...';
      default:
        return '';
    }
  };

  // ====== 自动滚动到底部 ======
  useEffect(() => {
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 100);
  }, [messages]);

  // ====== 渲染 ======
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" />

      {/* ── 顶部栏 ── */}
      <View style={styles.topBar}>
        <View style={styles.topBarRow}>
          <Text style={styles.topBarTitle}>AI 通话</Text>
          <TouchableOpacity
            style={styles.historyButton}
            onPress={() => router.push('/oral-history')}
            activeOpacity={0.7}
          >
            <Feather name="clock" size={18} color="#A78BFA" />
            <Text style={styles.historyButtonText}>历史对话</Text>
          </TouchableOpacity>
        </View>
        {isActive && (
          <Text style={styles.timerHint}>1分钟内无声音将自动挂断</Text>
        )}
      </View>

      {/* ── 中心区域 ── */}
      <View style={styles.centerArea}>
        {/* 波形 / 圆圈动画 */}
        {status === 'listening' && isActive ? (
          /* 实时波形动画（listening 状态） */
          <View style={styles.waveformContainer}>
            <View style={styles.waveformRow}>
              {audioLevels.map((level, index) => {
                const barHeight = Math.max(4, level * 60 + 4);
                return (
                  <View
                    key={index}
                    style={[
                      styles.waveformBar,
                      {
                        height: barHeight,
                        backgroundColor:
                          level > 0.3
                            ? '#A78BFA'
                            : level > 0.1
                            ? 'rgba(167, 139, 250, 0.6)'
                            : 'rgba(167, 139, 250, 0.2)',
                      },
                    ]}
                  />
                );
              })}
            </View>
          </View>
        ) : (
          /* 圆圈动画（仅 idle 状态显示，speaking/thinking 用 PixelFace） */
          status === 'idle' ? (
            <Animated.View
              style={[
                styles.waveCircle,
                {
                  transform: [
                    {
                      scale: breathingAnim,
                    },
                  ],
                },
              ]}
            >
              <Feather name="mic" size={40} color="#fff" />
            </Animated.View>
          ) : null
        )}

        {/* 状态文本 */}
        <Text style={styles.statusText}>{getStatusText()}</Text>

        {/* 思考动效（thinking 状态显示） */}
        {status === 'thinking' && (
          <View style={styles.thinkingContainer}>
            <View style={styles.thinkingDots}>
              <Animated.View
                style={[styles.dot, { transform: [{ translateY: dot1Anim }] }]}
              />
              <Animated.View
                style={[styles.dot, { transform: [{ translateY: dot2Anim }] }]}
              />
              <Animated.View
                style={[styles.dot, { transform: [{ translateY: dot3Anim }] }]}
              />
            </View>
          </View>
        )}

        {/* AI 当前文本（speaking 时显示，逐字呈现） */}
        {status === 'speaking' && aiText ? (
          <Text style={styles.aiSpeechText}>
            {displayedText || ''}
            {/* 闪烁的光标，表示正在朗读中 */}
            <Text style={styles.cursor}>▌</Text>
          </Text>
        ) : null}
      </View>

      {/* ── 底部对话预览 ── */}
      {messages.length > 0 && (
        <View style={styles.chatPreviewArea}>
          <ScrollView
            ref={scrollViewRef}
            style={styles.chatScroll}
            contentContainerStyle={styles.chatScrollContent}
            showsVerticalScrollIndicator={false}
          >
            {messages.map((msg, idx) => (
              <View
                key={idx}
                style={[
                  styles.chatBubble,
                  msg.role === 'user' ? styles.chatBubbleUser : styles.chatBubbleAI,
                ]}
              >
                <Text
                  style={[
                    styles.chatBubbleText,
                    msg.role === 'user' ? styles.chatBubbleTextUser : styles.chatBubbleTextAI,
                  ]}
                >
                  {msg.text}
                </Text>
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {/* ── 底部控制按钮 ── */}
      <View style={[styles.bottomArea, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        {!isActive ? (
          <TouchableOpacity
            style={styles.startButton}
            onPress={startCall}
            activeOpacity={0.8}
          >
            <Feather name="phone-call" size={22} color="#fff" />
            <Text style={styles.startButtonText}>开始通话</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.activeControls}>
            {/* 挂断按钮 */}
            <TouchableOpacity
              style={styles.endButton}
              onPress={endCall}
              activeOpacity={0.8}
            >
              <Feather name="phone-off" size={22} color="#fff" />
              <Text style={styles.endButtonText}>结束通话</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* 打卡成功 Toast */}
      {toastMessage && (
        <View style={styles.toast}>
          <Text style={styles.toastText}>{toastMessage}</Text>
        </View>
      )}

      {/* 成就解锁弹窗 */}
      <AchievementUnlockModal
        isVisible={achievementModalVisible}
        badgeId={newlyUnlockedBadgeId}
        onClose={() => setAchievementModalVisible(false)}
      />
    </View>
  );
}

// ====== 样式 ======
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },
  historyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(167, 139, 250, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(167, 139, 250, 0.2)',
  },
  historyButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#A78BFA',
  },

  // ── 顶部栏 ──
  topBar: {
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  topBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topBarTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
  timerHint: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    marginTop: 4,
    marginLeft: 2,
  },

  // ── 中心区域 ──
  centerArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  waveCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(167, 139, 250, 0.2)',
    borderWidth: 2,
    borderColor: 'rgba(167, 139, 250, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  waveCircleSpeaking: {
    borderColor: '#6EE7B7',
    backgroundColor: 'rgba(110, 231, 183, 0.15)',
    shadowColor: '#6EE7B7',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 20,
    elevation: 10,
  },
  waveCircleThinking: {
    borderColor: '#FBBF24',
    backgroundColor: 'rgba(251, 191, 36, 0.1)',
  },
  statusText: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.7)',
    marginBottom: 8,
    textAlign: 'center',
  },
  thinkingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  thinkingText: {
    fontSize: 13,
    color: '#FBBF24',
  },
  cursor: {
    fontSize: 15,
    color: '#A78BFA',
    opacity: 0.8,
  },
  aiSpeechText: {
    fontSize: 15,
    color: '#E2E8F0',
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: 16,
  },

  // ── 波形动画 ──
  waveformContainer: {
    width: 160,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  waveformRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    height: 64,
  },
  waveformBar: {
    width: 3,
    borderRadius: 2,
    minHeight: 4,
  },

  // ── 对话预览 ──
  chatPreviewArea: {
    maxHeight: 180,
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  chatScroll: {
    flex: 1,
  },
  chatScrollContent: {
    paddingVertical: 8,
  },
  chatBubble: {
    maxWidth: '80%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    marginBottom: 8,
  },
  chatBubbleAI: {
    backgroundColor: 'rgba(167, 139, 250, 0.15)',
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 4,
  },
  chatBubbleUser: {
    backgroundColor: 'rgba(110, 231, 183, 0.15)',
    alignSelf: 'flex-end',
    borderBottomRightRadius: 4,
  },
  chatBubbleText: {
    fontSize: 14,
    lineHeight: 20,
  },
  chatBubbleTextAI: {
    color: '#E2E8F0',
  },
  chatBubbleTextUser: {
    color: '#D1FAE5',
  },

  // ── 底部控制区 ──
  bottomArea: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  startButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#A78BFA',
    paddingVertical: 16,
    borderRadius: 16,
    gap: 10,
  },
  startButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#fff',
  },
  activeControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  endButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EF4444',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 14,
    gap: 8,
    flex: 1,
  },
  endButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },

  // ── 思考动效 ──
  thinkingContainer: {
    marginTop: 16,
    alignItems: 'center',
  },
  thinkingDots: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    height: 32,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FBBF24',
  },

  // ── Toast ──
  toast: {
    position: 'absolute',
    bottom: 120,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(16, 185, 129, 0.95)',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 100,
  },
  toastText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
    textAlign: 'center',
    lineHeight: 22,
  },
});
