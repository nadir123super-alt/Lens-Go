import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import AppLogo from '@/components/AppLogo';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { AuthProvider, useAuth } from '@/services/AuthContext';
import { initDictionary } from '@/services/dictionaryService';
import { PracticeProvider } from '@/services/practiceContext';

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
 * 自定义 Splash 封面样式 — 在字体加载期间显示 Logo + LensGo 文字
 */
const splashStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFB5C2',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: '#FFFFFF',
    marginTop: 20,
    letterSpacing: 4,
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

  // ★ 初始化未完成时，不显示任何 loading 提示
  // Splash 封面消失后，AuthProvider 才开始挂载并初始化。
  // 此时 isInitializing 为 true，但 Splash 刚结束，用户不会感知到短暂空白。
  // resolveAuthState() 从 AsyncStorage 读取 session 是毫秒级操作，
  // 显示 "正在验证身份" 反而会造成闪烁，影响用户体验。
  if (isInitializing) {
    return null;
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
      <Stack.Screen name="oral-history" options={{ headerShown: false, presentation: 'card' }} />
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

  // ★ 强制展示自定义 Splash 封面，不管字体是否已加载
  // 即使字体已缓存（loaded 瞬间为 true），也至少展示 SPLASH_MIN_DISPLAY_MS 毫秒
  const SPLASH_MIN_DISPLAY_MS = 2000;
  const [showSplash, setShowSplash] = useState(true);

  // ★ 所有 useEffect 必须在任何条件 return 之前声明，以遵守 React Hooks 规则
  useEffect(() => {
    // 字体加载完成后，等待 SPLASH_MIN_DISPLAY_MS 再隐藏封面
    if (loaded || error) {
      const timer = setTimeout(() => {
        setShowSplash(false);
        SplashScreen.hideAsync();
      }, SPLASH_MIN_DISPLAY_MS);
      return () => clearTimeout(timer);
    }
  }, [loaded, error]);

  useEffect(() => {
    // 仅在封面隐藏后（showSplash === false）才执行初始化任务
    if (!showSplash && (loaded || error)) {
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

      // 发音点击计数由 audioCounter 模块在内存中维护，无需从数据库加载
    }
  }, [showSplash, loaded, error]);

  // ★ 在字体加载完成前，或强制展示时间内，显示自定义 Splash 封面
  if (showSplash) {
    return (
      <View style={splashStyles.container}>
        <AppLogo size={160} />
        <Text style={splashStyles.title}>Lens Go</Text>
      </View>
    );
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
