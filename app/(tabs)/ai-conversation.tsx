/**
 * AI 实时口语通话模块 (Step 2 & 3 — 腾讯云 ASR + 硅基流动 LLM + 系统 TTS 闭环)
 *
 * 功能：
 * - 沉浸式深色通话界面
 * - 状态机管理：idle → speaking(开场白) → listening → thinking → speaking(AI回复)
 * - 2分钟无声自动挂断计时器
 * - 手动挂断按钮
 * - 实时音量波形动画（绑定真实麦克风音量）
 * - VAD 静音检测自动断句（1.5~2秒静音触发）
 * - 状态锁：thinking/speaking 时阻断 VAD
 * - 腾讯云 ASR 语音转写（STT）
 * - 硅基流动 Qwen2.5-72B-Instruct LLM 中英混说智能纠错
 * - 系统原生 TTS（expo-speech）播放 AI 回复，onDone 回调自动重启录音
 * - 防回音状态锁：TTS 播放期间完全阻断麦克风和 VAD
 */
import { Feather } from '@expo/vector-icons';
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ConversationMessage, getAiReply, transcribeAudio } from '../../services/aiConversationService';
import { playText, stopAll } from '../../services/soundManager';

// ====== 类型定义 ======
type CallStatus = 'idle' | 'listening' | 'thinking' | 'speaking';

interface Message {
  role: 'ai' | 'user';
  text: string;
}

// ====== 开场白库 ======
const OPENING_LINES = [
  "Hey! I've been waiting to chat with you. How's everything going?",
  "Hi there! Ready to practice some English? What's on your mind today?",
  "Hello! Let's talk about your day. Did anything interesting happen?",
];

function getRandomOpening(): string {
  return OPENING_LINES[Math.floor(Math.random() * OPENING_LINES.length)];
}

// ====== 常量 ======
const INACTIVITY_TIMEOUT_MS = 120_000; // 2 分钟
const VAD_SILENCE_THRESHOLD_DB = -50; // 静音阈值 (dBFS)，高于此值视为有人说话
const VAD_SILENCE_TIMEOUT_MS = 1800;  // 静音持续 1.8 秒触发断句
const METERING_INTERVAL_MS = 150;     // 音量采样间隔 150ms
const WAVEFORM_BARS = 32;             // 波形条数量

// expo-av 录音配置（与 recordingService 保持一致）
const RECORDING_OPTIONS: Audio.RecordingOptions = {
  android: {
    extension: '.3gp',
    outputFormat: Audio.AndroidOutputFormat.THREE_GPP,
    audioEncoder: Audio.AndroidAudioEncoder.AMR_NB,
    sampleRate: 8000,
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
};

// ====== 主页面 ======
export default function AIConversationScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  // ── 状态 ──
  const [isActive, setIsActive] = useState(false);
  const [status, setStatus] = useState<CallStatus>('idle');
  const [messages, setMessages] = useState<Message[]>([]);
  const [aiText, setAiText] = useState('');
  const [audioLevels, setAudioLevels] = useState<number[]>(new Array(WAVEFORM_BARS).fill(0));

  // ── 动画 ──
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const breatheAnim = useRef(new Animated.Value(1)).current;
  const scrollViewRef = useRef<ScrollView>(null);

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

  // ── 对话历史（用于 LLM 上下文） ──
  const conversationHistoryRef = useRef<ConversationMessage[]>([]);

  // ── STT/LLM 处理中标志 ──
  const [isProcessing, setIsProcessing] = useState(false);

  // ====== 清理 ======
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      clearInactivityTimer();
      cleanupRecording();
    };
  }, []);

  // ====== 呼吸动画（idle 状态） ======
  useEffect(() => {
    if (status === 'idle') {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(breatheAnim, {
            toValue: 0.6,
            duration: 1500,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(breatheAnim, {
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
      breatheAnim.setValue(1);
    }
  }, [status, breatheAnim]);

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
      if (isMountedRef.current) {
        console.log('[AIConversation] 2分钟无活动，自动挂断');
        endCall();
      }
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

      // 2. 设置音频模式
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

      // 3. 创建录音
      const { recording } = await Audio.Recording.createAsync(RECORDING_OPTIONS);
      recordingRef.current = recording;
      isRecordingRef.current = true;
      audioUriRef.current = null;

      console.log('[AIConversation] ✅ 录音已启动');

      // 4. 启动音量轮询（每 150ms 采样一次）
      startMetering(recording);

      // 5. 重置静音计时器（开始监听 VAD）
      resetSilenceTimer();

      // 6. 重置活动计时器
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

    meteringTimerRef.current = setInterval(async () => {
      if (!isMountedRef.current) return;
      try {
        const recStatus = await recording.getStatusAsync();
        if (!recStatus.isRecording) {
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

        // 更新波形数据
        setAudioLevels((prev) => {
          const newLevels = [...prev];
          // 将新音量值推到数组末尾，移除最旧的
          newLevels.push(normalizedVolume);
          newLevels.shift();
          return newLevels;
        });

        // VAD 检测（仅在 listening 状态且未锁定时）
        if (status === 'listening' && !vadLockedRef.current) {
          handleVAD(normalizedVolume);
        }
      } catch {
        // metering 读取失败，忽略
      }
    }, METERING_INTERVAL_MS);
  }, [status]);

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
    if (status !== 'listening') return;

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
    setStatus('thinking');
    setIsProcessing(true);

    // 3. 重置波形
    setAudioLevels(new Array(WAVEFORM_BARS).fill(0));
    resetInactivityTimer();

    // 4. STT：语音转文字（腾讯云 ASR）
    console.log('[AIConversation] 🎤 开始语音转写（腾讯云 ASR）...');
    const userText = await transcribeAudio(uri);

    if (!userText) {
      console.warn('[AIConversation] ⚠️ 语音转写结果为空，跳过本轮');
      // 空音频：直接重启录音
      setIsProcessing(false);
      setStatus('listening');
      vadLockedRef.current = false;
      startRecording();
      resetInactivityTimer();
      return;
    }

    console.log('[AIConversation] ✅ 转写结果:', userText);

    // 5. 将用户消息添加到对话预览
    setMessages((prev) => [...prev, { role: 'user', text: userText }]);

    // 6. LLM：获取 AI 回复（硅基流动 Qwen2.5-72B）
    console.log('[AIConversation] 🤖 调用硅基流动 LLM 生成回复...');
    const aiReply = await getAiReply(userText, conversationHistoryRef.current);

    console.log('[AIConversation] ✅ AI 回复:', aiReply);

    // 7. 更新对话历史
    conversationHistoryRef.current.push(
      { role: 'user', content: userText },
      { role: 'assistant', content: aiReply }
    );

    // 8. 显示 AI 回复
    setIsProcessing(false);
    setAiText(aiReply);
    setStatus('speaking');
    setMessages((prev) => [...prev, { role: 'ai', text: aiReply }]);
    resetInactivityTimer();

    // 9. 防回音状态锁：TTS 播放期间完全阻断麦克风和 VAD
    // vadLockedRef.current 已经为 true，保持锁定

    // 10. 使用系统原生 TTS 播放 AI 回复，onDone 回调自动重启录音
    playText(aiReply, () => {
      // onDone 回调：TTS 播放完毕
      if (!isMountedRef.current) return;

      console.log('[AIConversation] ✅ TTS 播放完毕，重启录音');

      // 解锁 VAD（防回音状态锁解除）
      vadLockedRef.current = false;
      setStatus('listening');

      // 重新激活麦克风和 VAD 监听
      startRecording();
      resetInactivityTimer();
    });
  }, [status, stopRecording, resetInactivityTimer, startRecording]);

  // ====== 重置静音计时器 ======
  const resetSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  // ====== 开始通话 ======
  const startCall = useCallback(() => {
    setIsActive(true);
    setMessages([]);
    setAudioLevels(new Array(WAVEFORM_BARS).fill(0));
    vadLockedRef.current = false;
    setIsProcessing(false);
    conversationHistoryRef.current = [];

    // 随机选开场白
    const opening = getRandomOpening();
    setAiText(opening);
    setStatus('speaking');
    setMessages([{ role: 'ai', text: opening }]);

    // 将开场白加入对话历史
    conversationHistoryRef.current.push(
      { role: 'assistant', content: opening }
    );

    // 启动 2 分钟计时器
    resetInactivityTimer();

    // 防回音状态锁：开场白 TTS 播放期间阻断麦克风
    vadLockedRef.current = true;

    // 使用系统原生 TTS 播放开场白，onDone 回调自动切换到 listening
    playText(opening, () => {
      if (!isMountedRef.current) return;

      console.log('[AIConversation] ✅ 开场白播放完毕，切换到聆听模式');

      // 解锁 VAD（防回音状态锁解除）
      vadLockedRef.current = false;
      setStatus('listening');

      // 启动录音
      startRecording();
      resetInactivityTimer();
    });
  }, [resetInactivityTimer, startRecording]);

  // ====== 结束通话 ======
  const endCall = useCallback(() => {
    clearInactivityTimer();
    cleanupRecording();
    // 停止 TTS 播放
    stopAll();
    setIsActive(false);
    setStatus('idle');
    setAiText('');
    setAudioLevels(new Array(WAVEFORM_BARS).fill(0));
    vadLockedRef.current = false;
    setIsProcessing(false);
    conversationHistoryRef.current = [];
    router.back();
  }, [router, cleanupRecording]);

  // ====== 状态文本 ======
  const getStatusText = (): string => {
    switch (status) {
      case 'idle':
        return '点击下方按钮开始 AI 口语对话';
      case 'listening':
        return 'AI 正在听你说话...';
      case 'thinking':
        return 'AI 正在思考...';
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
        <Text style={styles.topBarTitle}>AI 通话</Text>
        {isActive && (
          <Text style={styles.timerHint}>2分钟内无声音将自动挂断</Text>
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
          /* 圆圈动画（非 listening 状态） */
          <Animated.View
            style={[
              styles.waveCircle,
              {
                transform: [
                  {
                    scale:
                      status === 'idle'
                        ? breatheAnim
                        : status === 'speaking'
                        ? pulseAnim
                        : new Animated.Value(1),
                  },
                ],
              },
              status === 'speaking' && styles.waveCircleSpeaking,
              status === 'thinking' && styles.waveCircleThinking,
            ]}
          >
            <Feather
              name={status === 'speaking' ? 'volume-2' : 'mic'}
              size={40}
              color="#fff"
            />
          </Animated.View>
        )}

        {/* 状态文本 */}
        <Text style={styles.statusText}>
          {isProcessing ? 'AI 正在处理你的语音...' : getStatusText()}
        </Text>

        {/* thinking 状态加载指示器 */}
        {status === 'thinking' && isProcessing && (
          <View style={styles.thinkingIndicator}>
            <ActivityIndicator size="small" color="#FBBF24" />
            <Text style={styles.thinkingText}>语音转写 & 生成回复中...</Text>
          </View>
        )}

        {/* AI 当前文本（speaking 时显示） */}
        {status === 'speaking' && aiText ? (
          <Text style={styles.aiSpeechText}>{aiText}</Text>
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
    </View>
  );
}

// ====== 样式 ======
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F0A2E',
  },

  // ── 顶部栏 ──
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  topBarTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
  timerHint: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
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
});
