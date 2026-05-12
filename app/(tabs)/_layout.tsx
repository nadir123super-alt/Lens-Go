/**
 * Tab Layout — 纯图标底部导航栏
 *
 * 五个 Tab（无文字标签）：
 *   - 🏠 首页 Dashboard → index
 *   - 📷 拍照识别 → camera
 *   - 🎤 口语练习 → practice
 *   - 🔍 词典查询 → search
 *   - 📖 生词本 → vocabulary
 *
 * 设计规范：
 *   - 无文字：tabBarShowLabel = false
 *   - 图标大小：默认 28px，选中放大至 30px
 *   - 选中颜色：#FF4D4F，且有 translateY -3 上浮效果
 *   - 高度：70px
 *   - 纯白背景 #FFFFFF，清晰的顶部边界线
 *   - 非绝对定位：页面内容不被导航栏遮挡
 */
import { Feather } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import React from 'react';
import { Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HapticTab } from '@/components/haptic-tab';
import { useColorScheme } from '@/hooks/use-color-scheme';

const ACTIVE_COLOR = '#FF4D4F';
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

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();

  const inactiveColor = isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.35)';
  const bgColor = isDark ? '#1a1a1a' : '#FFFFFF';
  const borderColor = isDark ? '#333' : '#e8e8e8';

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
            <TabIcon iconName="home" color={color} focused={focused} />
          ),
        }}
      />

      {/* Tab 1 — 拍照识别（直接渲染 CameraScreen） */}
      <Tabs.Screen
        name="camera"
        options={{
          tabBarIcon: ({ color, focused }) => (
            <TabIcon iconName="camera" color={color} focused={focused} />
          ),
        }}
      />

      {/* Tab 2 — 口语练习（直接渲染 PracticeScreen） */}
      <Tabs.Screen
        name="practice"
        options={{
          tabBarIcon: ({ color, focused }) => (
            <TabIcon iconName="mic" color={color} focused={focused} />
          ),
        }}
      />

      {/* Tab 3 — 词典查询（直接渲染 SearchScreen） */}
      <Tabs.Screen
        name="search"
        options={{
          tabBarIcon: ({ color, focused }) => (
            <TabIcon iconName="search" color={color} focused={focused} />
          ),
        }}
      />

      {/* Tab 4 — 生词本 */}
      <Tabs.Screen
        name="vocabulary"
        options={{
          tabBarIcon: ({ color, focused }) => (
            <TabIcon iconName="book-open" color={color} focused={focused} />
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
          // ★ 关键：通过 href: null 禁用路由导航 + tabBarItemStyle 隐藏 Tab
          //   防止 Expo Router 因文件系统发现 (evaluation-summary.tsx 在 (tabs) 目录下)
          //   自动为其创建第 6 个 Tab
          href: null,
          tabBarItemStyle: { display: 'none' },
        }}
      />
    </Tabs>
  );
}
