/**
 * AchievementsScreen — 勋章墙页面（增强版）
 *
 * 布局：
 *   - 顶部：标题 + 已解锁统计
 *   - 进度条：总体解锁进度
 *   - 分类展示："基础"、"进阶"、"趣味" 三个板块
 *   - 每个勋章：
 *     - 已解锁：彩色显示，点击弹出 Modal 显示解锁时间 + 趣味描述
 *     - 未解锁：灰色半透明，量化勋章显示进度条
 *   - Modal：详情弹窗
 */
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  BadgeDefinition,
  getAllBadgesWithRealProgress
} from '@/services/achievementService';
import { supabase } from '@/services/supabaseClient';

const SCREEN_WIDTH = Dimensions.get('window').width;
const GRID_PADDING = 20;
const GRID_GAP = 10;
const ITEM_SIZE = (SCREEN_WIDTH - GRID_PADDING * 2 - GRID_GAP * 2) / 3;

type BadgeWithStatus = BadgeDefinition & {
  unlocked: boolean;
  unlockedAt: string | null;
};

const CATEGORY_LABELS: Record<string, string> = {
  basic: '基础成就',
  advanced: '进阶成就',
  fun: '趣味成就',
};

const CATEGORY_ICONS: Record<string, keyof typeof Feather.glyphMap> = {
  basic: 'star',
  advanced: 'zap',
  fun: 'smile',
};

export default function AchievementsScreen() {
  const insets = useSafeAreaInsets();
  const [badges, setBadges] = useState<BadgeWithStatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedBadge, setSelectedBadge] = useState<BadgeWithStatus | null>(null);

  const loadBadges = useCallback(async () => {
    setIsLoading(true);
    try {
      // 每次加载时直接从 auth 获取当前用户 ID，避免 state 延迟
      const { data: { user } } = await supabase.auth.getUser();
      const uid = user?.id || undefined;
      const data = await getAllBadgesWithRealProgress(uid);
      setBadges(data);
    } catch (err) {
      console.warn('[Achievements] 加载勋章数据失败:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadBadges();
    }, [loadBadges]),
  );

  const unlockedCount = badges.filter((b) => b.unlocked).length;
  const totalCount = badges.length;
  const progressPercentage = totalCount > 0 ? (unlockedCount / totalCount) * 100 : 0;

  // 按分类分组
  const grouped = {
    basic: badges.filter((b) => b.category === 'basic'),
    advanced: badges.filter((b) => b.category === 'advanced'),
    fun: badges.filter((b) => b.category === 'fun'),
  };

  const renderBadgeItem = (badge: BadgeWithStatus) => (
    <TouchableOpacity
      key={badge.id}
      style={[
        s.badgeItem,
        {
          backgroundColor: badge.unlocked
            ? badge.color + '22'
            : 'rgba(255,255,255,0.05)',
          borderColor: badge.unlocked ? badge.color : 'rgba(255,255,255,0.1)',
          opacity: badge.unlocked ? 1 : 0.5,
        },
      ]}
      activeOpacity={0.7}
      onPress={() => setSelectedBadge(badge)}
    >
      <Feather
        name={badge.icon as any}
        size={26}
        color={badge.unlocked ? badge.color : '#666'}
      />
      <Text
        style={[
          s.badgeName,
          { color: badge.unlocked ? '#FFFFFF' : '#888' },
        ]}
        numberOfLines={1}
      >
        {badge.name}
      </Text>
      {/* 量化进度条（未解锁时显示） */}
      {!badge.unlocked && badge.progress && badge.progress.target > 0 && (
        <View style={s.miniProgressBg}>
          <View
            style={[
              s.miniProgressFill,
              {
                width: `${Math.min((badge.progress.current / badge.progress.target) * 100, 100)}%`,
                backgroundColor: badge.color,
              },
            ]}
          />
        </View>
      )}
    </TouchableOpacity>
  );

  const renderSection = (category: 'basic' | 'advanced' | 'fun') => {
    const items = grouped[category];
    if (items.length === 0) return null;
    const sectionUnlocked = items.filter((b) => b.unlocked).length;

    return (
      <View style={s.section} key={category}>
        <View style={s.sectionHeader}>
          <Feather
            name={CATEGORY_ICONS[category]}
            size={16}
            color="#FF6B6B"
          />
          <Text style={s.sectionTitle}>{CATEGORY_LABELS[category]}</Text>
          <Text style={s.sectionCount}>
            {sectionUnlocked}/{items.length}
          </Text>
        </View>
        <View style={s.grid}>
          {items.map(renderBadgeItem)}
        </View>
      </View>
    );
  };

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      {/* ===== 顶部标题 ===== */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => { try { require('expo-router').router.back(); } catch {} }} activeOpacity={0.7}>
          <Feather name="arrow-left" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={s.headerContent}>
          <Text style={s.title}>我的成就</Text>
          <Text style={s.subtitle}>
            已解锁 {unlockedCount}/{totalCount} 个勋章
          </Text>
        </View>
      </View>

      {/* ===== 总体进度条 ===== */}
      <View style={s.progressBarBg}>
        <View
          style={[
            s.progressBarFill,
            { width: `${progressPercentage}%` },
          ]}
        />
      </View>

      {/* ===== 分类列表 ===== */}
      {isLoading ? (
        <View style={s.loadingWrap}>
          <ActivityIndicator size="large" color="#FF6B6B" />
        </View>
      ) : (
        <ScrollView
          style={s.scroll}
          contentContainerStyle={{ paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
        >
          {renderSection('basic')}
          {renderSection('advanced')}
          {renderSection('fun')}
        </ScrollView>
      )}

      {/* ===== 详情弹窗 ===== */}
      <Modal
        visible={selectedBadge !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedBadge(null)}
      >
        <TouchableOpacity
          style={s.modalOverlay}
          activeOpacity={1}
          onPress={() => setSelectedBadge(null)}
        >
          <TouchableOpacity
            style={s.modalContent}
            activeOpacity={1}
            onPress={() => {}}
          >
            {selectedBadge && (
              <>
                {/* 勋章图标 */}
                <View
                  style={[
                    s.modalIconWrap,
                    {
                      backgroundColor: selectedBadge.color + '22',
                      borderColor: selectedBadge.color,
                    },
                  ]}
                >
                  <Feather
                    name={selectedBadge.icon as any}
                    size={48}
                    color={selectedBadge.unlocked ? selectedBadge.color : '#666'}
                  />
                </View>

                {/* 勋章名称 */}
                <Text style={s.modalTitle}>{selectedBadge.name}</Text>

                {/* 分类标签 */}
                <View style={s.categoryTag}>
                  <Text style={s.categoryTagText}>
                    {CATEGORY_LABELS[selectedBadge.category]}
                  </Text>
                </View>

                {/* 状态标签 */}
                <View
                  style={[
                    s.statusTag,
                    {
                      backgroundColor: selectedBadge.unlocked
                        ? '#34C759' + '22'
                        : 'rgba(255,255,255,0.1)',
                    },
                  ]}
                >
                  <Text
                    style={[
                      s.statusText,
                      { color: selectedBadge.unlocked ? '#34C759' : '#999' },
                    ]}
                  >
                    {selectedBadge.unlocked ? '✅ 已解锁' : '🔒 未解锁'}
                  </Text>
                </View>

                {/* 描述 */}
                <Text style={s.modalDesc}>
                  {selectedBadge.unlocked
                    ? selectedBadge.description
                    : selectedBadge.unlockHint}
                </Text>

                {/* 量化进度条（Modal 内） */}
                {selectedBadge.progress && selectedBadge.progress.target > 0 && (
                  <View style={s.modalProgressSection}>
                    <View style={s.modalProgressLabel}>
                      <Text style={s.modalProgressText}>
                        进度：{selectedBadge.progress.current}/{selectedBadge.progress.target}
                      </Text>
                      <Text style={s.modalProgressPct}>
                        {Math.round(
                          (selectedBadge.progress.current / selectedBadge.progress.target) * 100
                        )}%
                      </Text>
                    </View>
                    <View style={s.modalProgressBg}>
                      <View
                        style={[
                          s.modalProgressFill,
                          {
                            width: `${Math.min(
                              (selectedBadge.progress.current / selectedBadge.progress.target) * 100,
                              100
                            )}%`,
                            backgroundColor: selectedBadge.color,
                          },
                        ]}
                      />
                    </View>
                  </View>
                )}

                {/* 解锁时间 */}
                {selectedBadge.unlocked && selectedBadge.unlockedAt && (
                  <Text style={s.modalTime}>
                    🕐 解锁时间：{formatDate(selectedBadge.unlockedAt)}
                  </Text>
                )}
              </>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

function formatDate(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${day} ${h}:${min}`;
  } catch {
    return isoStr;
  }
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212' },

  /* ── 顶部 ── */
  header: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    paddingHorizontal: 20, 
    paddingTop: 20, 
    paddingBottom: 8 
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -15,
  },
  headerContent: {
    flex: 1,
  },
  title: { fontSize: 28, fontWeight: '800', color: '#FFFFFF' },
  subtitle: { fontSize: 14, color: '#BBBBBB', marginTop: 4 },

  /* ── 总体进度条 ── */
  progressBarBg: {
    height: 6,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 3,
    marginHorizontal: 20,
    marginBottom: 20,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#FF6B6B',
    borderRadius: 3,
  },

  /* ── 加载 ── */
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  /* ── 分类区块 ── */
  section: { marginBottom: 24 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 12,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    flex: 1,
  },
  sectionCount: {
    fontSize: 13,
    color: '#BBBBBB',
    fontWeight: '600',
  },

  /* ── 网格 ── */
  scroll: { flex: 1 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: GRID_PADDING,
    gap: GRID_GAP,
  },
  badgeItem: {
    width: ITEM_SIZE,
    height: ITEM_SIZE + 8,
    borderRadius: 18,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    paddingVertical: 8,
  },
  badgeName: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 6,
    textAlign: 'center',
  },

  /* ── 迷你进度条（网格内） ── */
  miniProgressBg: {
    width: '80%',
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 1.5,
    marginTop: 4,
    overflow: 'hidden',
  },
  miniProgressFill: {
    height: '100%',
    borderRadius: 1.5,
  },

  /* ── Modal ── */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  modalContent: {
    backgroundColor: '#1E1E1E',
    borderRadius: 24,
    padding: 32,
    alignItems: 'center',
    width: '100%',
    maxWidth: 320,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  modalIconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  categoryTag: {
    paddingHorizontal: 12,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: 'rgba(255,107,107,0.15)',
    marginBottom: 12,
  },
  categoryTagText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FF6B6B',
  },
  statusTag: {
    paddingHorizontal: 16,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 16,
  },
  statusText: { fontSize: 13, fontWeight: '600' },
  modalDesc: {
    fontSize: 15,
    color: '#CCCCCC',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 12,
  },

  /* ── Modal 进度条 ── */
  modalProgressSection: {
    width: '100%',
    marginBottom: 12,
  },
  modalProgressLabel: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  modalProgressText: {
    fontSize: 13,
    color: '#BBBBBB',
  },
  modalProgressPct: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  modalProgressBg: {
    height: 8,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  modalProgressFill: {
    height: '100%',
    borderRadius: 4,
  },

  modalTime: {
    fontSize: 13,
    color: '#999',
    textAlign: 'center',
  },
});
