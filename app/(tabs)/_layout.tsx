/**
 * Tab Layout — 纯图标底部导航栏
 *
 * 六个 Tab（无文字标签）：
 *   - 🏠 首页 Dashboard → index
 *   - 📷 拍照识别 → camera
 *   - 🎤 口语练习 → practice
 *   - 🤖 AI 通话 → ai-conversation
 *   - 🔍 词典查询 → search
 *   - 📖 生词本 → vocabulary
 *
 * 设计规范：
 *   - 无文字：tabBarShowLabel = false
 *   - 图标大小：默认 28px，选中放大至 30px
 *   - 选中颜色：马卡龙红色，且有 translateY -3 上浮效果
 *   - 高度：70px
 *   - 纯白背景 #FFFFFF，清晰的顶部边界线
 *   - 非绝对定位：页面内容不被导航栏遮挡
 *
 * 缓存预加载：
 *   用户点击"生词本"或"口语练习"Tab 时，立即触发网络请求预加载，
 *   页面组件挂载后直接消费缓存数据，无需等待请求。
 */
import AIIcon from '@/components/AIIcon';
import CameraIcon from '@/components/CameraIcon';
import { HapticTab } from '@/components/haptic-tab';
import HomeIcon from '@/components/HomeIcon';
import PracticeIcon from '@/components/PracticeIcon';
import SearchIcon from '@/components/SearchIcon';
import VocabularyIcon from '@/components/VocabularyIcon';
import { preloadPractice, preloadVocabulary } from '@/services/dataPreloader';
import { Feather } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import React, { useCallback } from 'react';
import { Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const ACTIVE_COLOR = '#FF6B6B';
const TABBAR_HEIGHT = Platform.OS === 'ios' ? 70 : 66;

/* ─── Tab 图标 ─── */
function TabIcon({
  iconName,
  color,
  focused,
}: {
  iconName: keyof typeof Feather.glyphMap;
  color: string;
  focused: boolean;
}) {
  return (
    <View style={focused ? { transform: [{ translateY: -3 }] } : undefined}>
      <Feather name={iconName} size={focused ? 30 : 28} color={color} />
    </View>
  );
}

/**
 * 带预加载功能的 Tab 按钮
 * 在 HapticTab 的基础上，点击时触发 preload 回调
 */
function PreloadTabButton({
  children,
  onPress,
  onPreload,
  ...rest
}: any) {
  const handlePress = useCallback(
    (event: any) => {
      onPreload?.();
      onPress?.(event);
    },
    [onPreload, onPress]
  );

  return (
    <HapticTab onPress={handlePress} {...rest}>
      {children}
    </HapticTab>
  );
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();

  // 固定黑色背景，不受系统深色/浅色模式影响
  const inactiveColor = 'rgba(255,255,255,0.4)';
  const bgColor = '#1a1a1a';
  const borderColor = '#333';

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarShowLabel: false,
        tabBarActiveTintColor: ACTIVE_COLOR,
        tabBarInactiveTintColor: inactiveColor,
        tabBarStyle: {
          backgroundColor: bgColor,
          borderTopWidth: 1,
          borderTopColor: borderColor,
          elevation: 0,
          height: TABBAR_HEIGHT + insets.bottom,
          paddingBottom: insets.bottom + 4,
          paddingTop: 6,
        },
      }}
    >
      {/* Tab 0 — 首页 Dashboard（默认首屏） */}
      <Tabs.Screen
        name="index"
        options={{
          title: '首页',
          tabBarIcon: ({ color, focused }) => (
            <HomeIcon color={color} size={focused ? 34 : 32} focused={focused} />
          ),
        }}
      />

      {/* Tab 1 — 拍照识别（直接渲染 CameraScreen） */}
      <Tabs.Screen
        name="camera"
        options={{
          tabBarIcon: ({ color, focused }) => (
            <CameraIcon color={color} size={focused ? 30 : 28} focused={focused} />
          ),
        }}
      />

      {/* Tab 2 — 口语练习（直接渲染 PracticeScreen） */}
      <Tabs.Screen
        name="practice"
        options={{
          tabBarIcon: ({ color, focused }) => (
            <PracticeIcon color={color} size={focused ? 30 : 28} focused={focused} />
          ),
          tabBarButton: (props) => (
            <PreloadTabButton {...props} onPreload={preloadPractice} />
          ),
        }}
      />

      {/* Tab 3 — AI 通话（AI 实时口语对话） */}
      <Tabs.Screen
        name="ai-conversation"
        options={{
          tabBarLabel: 'AI 通话',
          tabBarIcon: ({ color, focused }) => (
            <AIIcon color={color} size={focused ? 30 : 28} focused={focused} />
          ),
        }}
      />

      {/* Tab 4 — 词典查询（直接渲染 SearchScreen） */}
      <Tabs.Screen
        name="search"
        options={{
          tabBarIcon: ({ color, focused }) => (
            <SearchIcon color={color} size={focused ? 30 : 28} focused={focused} />
          ),
        }}
      />

      {/* Tab 5 — 生词本 */}
      <Tabs.Screen
        name="vocabulary"
        options={{
          tabBarIcon: ({ color, focused }) => (
            <VocabularyIcon color={color} size={focused ? 30 : 28} focused={focused} />
          ),
          tabBarButton: (props) => (
            <PreloadTabButton {...props} onPreload={preloadVocabulary} />
          ),
        }}
      />

      {/*
        隐藏的页面（不出现在底部导航栏）
      */}
      <Tabs.Screen
        name="achievements"
        options={{
          href: null,
          tabBarItemStyle: { display: 'none' },
        }}
      />

      <Tabs.Screen
        name="settings"
        options={{
          href: null,
          tabBarItemStyle: { display: 'none' },
        }}
      />

      {/*
        Evaluation-summary — 隐藏的页面（不出现在底部导航栏）
        仅供 PracticeTab 内部导入使用，不作为独立 Tab 展示
      */}
      <Tabs.Screen
        name="evaluation-summary"
        options={{
          href: null,
          tabBarItemStyle: { display: 'none' },
        }}
      />
    </Tabs>
  );
}
