import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { initDictionary } from '@/services/dictionaryService';
import { PracticeProvider } from '@/services/practiceContext';

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export const unstable_settings = {
  anchor: '(tabs)',
};

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
      <PracticeProvider>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack>
          <Stack.Screen name="login" options={{ headerShown: false }} />
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
        <StatusBar style="auto" />
      </ThemeProvider>
      </PracticeProvider>
    </GestureHandlerRootView>
  );
}
