import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { AuthProvider, useAuth } from '@/services/AuthContext';
import { initDictionary } from '@/services/dictionaryService';
import { PracticeProvider } from '@/services/practiceContext';

// ============================================================
// 运行时环境变量诊断 — 在 App 启动最开始时执行
// ============================================================
console.log('--- 环境变量加载状态 ---');
console.log('URL 是否存在:', !!process.env.EXPO_PUBLIC_SUPABASE_URL);
console.log('Anon Key 是否存在:', !!process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
console.log('Supabase URL 值:', process.env.EXPO_PUBLIC_SUPABASE_URL ? process.env.EXPO_PUBLIC_SUPABASE_URL.substring(0, 20) + '...' : '(空)');
console.log('--- 环境变量诊断结束 ---');

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export const unstable_settings = {
  anchor: '(tabs)',
};

/**
 * 全屏 Loading 组件 — 在 AuthContext 检测认证状态期间显示
 */
function FullScreenLoading() {
  return (
    <View style={loadingStyles.container}>
      <ActivityIndicator size="large" color="#FF6B6B" />
      <Text style={loadingStyles.text}>正在验证身份...</Text>
    </View>
  );
}

const loadingStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  text: {
    fontSize: 16,
    color: '#FFFFFF',
    marginTop: 16,
  },
});

/**
 * 内部布局 — 被 AuthProvider 包裹，可访问 useAuth()
 * 路由守卫逻辑：
 *   1. isInitializing → 显示全屏 Loading（极短暂，仅 onAuthStateChange 首次回调前）
 *   2. unauthenticated → 只渲染 login 页面（Stack 中其他页面不可访问）
 *   3. authenticated → 正常渲染所有页面
 *
 * 不再使用 authState === 'loading' 阻塞全屏。
 * 初始状态预设为 unauthenticated，如果本地有有效 session，
 * resolveAuthState 会快速切换为 authenticated，用户无感知。
 */
function RootLayoutInner() {
  const { authState, isInitializing } = useAuth();

  // 最高优先级：初始化未完成时，严禁渲染任何页面或执行跳转
  if (isInitializing) {
    return <FullScreenLoading />;
  }

  return (
    <Stack>
      <Stack.Screen name="login" options={{ headerShown: false, animation: 'none' }} />
      <Stack.Screen name="register" options={{ headerShown: false, animation: 'none' }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="camera" options={{ headerShown: false, presentation: 'fullScreenModal' }} />
      <Stack.Screen name="search" options={{ headerShown: false }} />
      <Stack.Screen name="practice" options={{ headerShown: false, presentation: 'card' }} />
      <Stack.Screen name="evaluation-summary" options={{ headerShown: false, presentation: 'card' }} />
      <Stack.Screen name="word-detail" options={{ headerShown: false, presentation: 'card' }} />
      <Stack.Screen name="settings-detail" options={{ headerShown: false, presentation: 'card' }} />
      <Stack.Screen name="edit-nickname" options={{ headerShown: false, presentation: 'card' }} />
      <Stack.Screen name="bind-phone" options={{ headerShown: false, presentation: 'card' }} />
      <Stack.Screen name="bind-email" options={{ headerShown: false, presentation: 'card' }} />
      <Stack.Screen name="bind-wechat" options={{ headerShown: false, presentation: 'card' }} />
      <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
    </Stack>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();

  const [loaded, error] = useFonts({
    MaterialIcons: require('@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/MaterialIcons.ttf'),
    MaterialCommunityIcons: require('@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/MaterialCommunityIcons.ttf'),
    Ionicons: require('@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Ionicons.ttf'),
  });

  useEffect(() => {
    if (loaded || error) {
      // 全局音频会话初始化：扬声器播放 + 录音 + 语音优化
      (async () => {
        try {
          const { Audio, InterruptionModeAndroid, InterruptionModeIOS } = await import('expo-av');
          await Audio.setAudioModeAsync({
            allowsRecordingIOS: true,
            playsInSilentModeIOS: true,
            staysActiveInBackground: false,
            shouldDuckAndroid: false,
            playThroughEarpieceAndroid: false,
            defaultToSpeaker: true,
            interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
            interruptionModeIOS: InterruptionModeIOS.DoNotMix,
          } as any);
          console.log('[RootLayout] ✅ 全局音频会话已初始化 (PlayAndRecord + Speaker)');

          // 强制扬声器输出 + 打印音频路由状态
          const { forceSpeakerOutput, logAudioRouteStatus, initAudioEnhancements } = await import('@/services/recordingService');
          await forceSpeakerOutput();
          logAudioRouteStatus();
          // 注册 TTS 播放前音频强化器（每次 TTS 前自动调用 forceSpeakerOutput）
          initAudioEnhancements();
        } catch (e: any) {
          console.warn('[RootLayout] ⚠️ 全局音频会话初始化失败:', e?.message);
        }
      })();

      // 初始化词典（异步，不阻塞 UI）
      initDictionary();

      // 初始化语音偏好设置（加载语速到内存缓存）
      (async () => {
        const { loadSpeechRate } = await import('@/services/speechSettingsService');
        await loadSpeechRate();
        console.log('[RootLayout] ✅ 语速设置已加载');
      })();

      // 初始化通知处理器
      (async () => {
        const { configureNotifications } = await import('@/services/reminderService');
        configureNotifications();
      })();

      // 发音点击计数由 audioCounter 模块在内存中维护，无需从数据库加载

      // Hide the splash screen after the fonts have loaded (or an error was returned)
      SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  // Prevent rendering until the font has loaded or an error was returned
  if (!loaded && !error) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <PracticeProvider>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <RootLayoutInner />
          <StatusBar style="auto" />
        </ThemeProvider>
        </PracticeProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
