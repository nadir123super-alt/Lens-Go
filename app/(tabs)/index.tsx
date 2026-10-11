/**
 * HomeScreen - 用户仪表盘（首页）
 *
 * 视觉风格：
 *   - 背景：#F7F7F7（浅灰）
 *   - 卡片：#FFFFFF（纯白）+ 圆角 18 + 微阴影
 *
 * 布局结构：
 *   1. 顶部个人资料（圆形头像、昵称、签名）
 *   2. 统计卡片（词汇量、学习天数、勋章）
 *   3. 工具列表（我的成就、语音偏好设置）
 *   4. 底部设置
 *
 * 数据来源：
 *   - 词汇量：Supabase user_word_scores 表，score >= 80 的单词数
 *   - 学习天数：Supabase study_logs 表，不重复日期数
 *   - 勋章：Supabase user_achievements 表
 */
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import UserAvatar from '@/components/UserAvatar';
import { BadgeDefinition, countUnlockedBadges, getBadgeById } from '@/services/achievementService';
import { countMasteredWords, countStudyDays } from '@/services/studyStatsService';
import { supabase } from '@/services/supabaseClient';

const ANCHOR_COLOR = '#FF6B6B';

/* ─── 统计卡片 ─── */
function StatCard({ value, label, icon, color }: {
  value: string; label: string; icon: keyof typeof Feather.glyphMap; color: string;
}) {
  return (
    <View style={statStyles.card}>
      <View style={[statStyles.iconBg, { backgroundColor: color + '18' }]}>
        <Feather name={icon} size={22} color={color} />
      </View>
      <Text style={statStyles.value}>{value}</Text>
      <Text style={statStyles.label}>{label}</Text>
    </View>
  );
}
const statStyles = StyleSheet.create({
  card: {
    flex: 1, alignItems: 'center', backgroundColor: '#2a2a2a', borderRadius: 18,
    paddingVertical: 18, paddingHorizontal: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12, shadowRadius: 8, elevation: 3,
  },
  iconBg: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center', marginBottom: 8,
  },
  value: { fontSize: 22, fontWeight: '800', color: '#FFFFFF' },
  label: { fontSize: 12, color: '#BBBBBB', marginTop: 2 },
});

/* ─── 菜单项 ─── */
function MenuRow({ icon, title, subtitle, onPress, color = '#888888' }: {
  icon: keyof typeof Feather.glyphMap; title: string; subtitle?: string;
  onPress: () => void; color?: string;
}) {
  return (
    <TouchableOpacity style={menuStyles.item} onPress={onPress} activeOpacity={0.6}>
      <View style={menuStyles.left}>
        <View style={[menuStyles.iconWrap, { backgroundColor: color + '14' }]}>
          <Feather name={icon} size={20} color={color} />
        </View>
        <View style={menuStyles.textGroup}>
          <Text style={menuStyles.title}>{title}</Text>
          {subtitle && <Text style={menuStyles.subtitle}>{subtitle}</Text>}
        </View>
      </View>
      <Feather name="chevron-right" size={18} color="#ccc" />
    </TouchableOpacity>
  );
}
const menuStyles = StyleSheet.create({
  item: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 16, paddingHorizontal: 16,
  },
  left: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  iconWrap: {
    width: 40, height: 40, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  textGroup: { marginLeft: 14, flex: 1 },
  title: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  subtitle: { fontSize: 13, color: '#BBBBBB', marginTop: 2 },
});

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [vocabCount, setVocabCount] = useState(0);
  const [studyDays, setStudyDays] = useState(0);
  const [badgeCount, setBadgeCount] = useState(0);
  const [userId, setUserId] = useState<string>('');
  const [avatarType, setAvatarType] = useState<number>(0);
  const [nickname, setNickname] = useState('英语学习者');

  // ── 勋章解锁弹窗（队列支持） ──
  const [showUnlockModal, setShowUnlockModal] = useState(false);
  const [unlockBadge, setUnlockBadge] = useState<BadgeDefinition | null>(null);
  const unlockAnim = useRef(new Animated.Value(0)).current;
  const unlockQueueRef = useRef<string[]>([]);

  useEffect(() => {
    if (showUnlockModal) {
      unlockAnim.setValue(0);
      Animated.spring(unlockAnim, {
        toValue: 1,
        tension: 50,
        friction: 8,
        useNativeDriver: true,
      }).start();
    }
  }, [showUnlockModal, unlockAnim]);

  // 从队列中弹出下一个勋章
  const showNextFromQueue = useCallback(() => {
    if (unlockQueueRef.current.length > 0) {
      const nextId = unlockQueueRef.current.shift()!;
      const badge = getBadgeById(nextId);
      if (badge) {
        setUnlockBadge(badge);
        setShowUnlockModal(true);
      } else {
        // 无效 ID，跳过
        showNextFromQueue();
      }
    }
  }, []);

  // 检查全局队列中是否有新解锁的勋章
  useEffect(() => {
    const checkInterval = setInterval(() => {
      const pendingList = (global as any).__pendingUnlockBadges;
      if (pendingList && Array.isArray(pendingList) && pendingList.length > 0) {
        (global as any).__pendingUnlockBadges = [];
        // 将新勋章加入队列
        for (const id of pendingList) {
          if (!unlockQueueRef.current.includes(id)) {
            unlockQueueRef.current.push(id);
          }
        }
        // 如果当前没有弹窗，开始展示
        if (!showUnlockModal) {
          showNextFromQueue();
        }
      }
    }, 500);
    return () => clearInterval(checkInterval);
  }, [showUnlockModal, showNextFromQueue]);

  // 关闭弹窗时，检查队列中是否还有下一个
  const handleCloseUnlock = useCallback(() => {
    setShowUnlockModal(false);
    setUnlockBadge(null);
    // 延迟一下再展示下一个，让关闭动画完成
    setTimeout(() => {
      showNextFromQueue();
    }, 300);
  }, [showNextFromQueue]);

  // 加载统计数据（词汇量 + 学习天数 + 勋章数）- 后台静默刷新
  const loadStats = useCallback(async (uid: string) => {
    try {
      const [vocabResult, daysResult, badgeResult] = await Promise.all([
        countMasteredWords(uid),
        countStudyDays(uid),
        countUnlockedBadges(uid),
      ]);
      // 直接更新状态，不显示加载提示
      setVocabCount(vocabResult);
      setStudyDays(daysResult);
      setBadgeCount(badgeResult);
    } catch (err) {
      console.warn('[HomeScreen] 加载统计数据失败:', err);
    }
  }, []);

  // 加载用户资料（头像 + 昵称）
  const loadUserProfile = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      setUserId(user.id);

      const { data: profile } = await supabase
        .from('profiles')
        .select('avatar_type, nickname')
        .eq('id', user.id)
        .single();

      if (profile) {
        setAvatarType(profile.avatar_type || 0);
        setNickname(profile.nickname || '英语学习者');
      }

      // 在 loadUserProfile 内部直接加载统计数据，避免闭包中 userId 未更新的问题
      loadStats(user.id);
    } catch (err) {
      console.warn('[HomeScreen] 加载用户资料失败:', err);
    }
  }, [loadStats]);

  // 每次页面获得焦点时自动刷新
  useFocusEffect(
    useCallback(() => {
      loadUserProfile();
    }, [loadUserProfile]),
  );

  return (
    <View style={s.container}>
      <StatusBar style="light" />
      <ScrollView
        style={s.scroll}
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ===== 顶部个人资料 ===== */}
        <View style={[s.profileSection, { paddingTop: insets.top + 20 }]}>
          <View style={s.avatarWrap}>
            {userId && avatarType > 0 ? (
              <UserAvatar userId={userId} avatarType={avatarType} size={88} />
            ) : (
              <View style={s.avatar}>
                <Feather name="user" size={40} color="#fff" />
              </View>
            )}
          </View>
          <Text style={s.userName}>{nickname}</Text>
          <Text style={s.userBio}>每天坚持学习 5 分钟</Text>
        </View>

        {/* ===== 统计卡片 ===== */}
        <View style={s.statsRow}>
          <StatCard value={String(vocabCount)} label="词汇量" icon="book" color={ANCHOR_COLOR} />
          <StatCard value={String(studyDays)} label="学习天数" icon="calendar" color="#4A90D9" />
          <StatCard value={String(badgeCount)} label="勋章" icon="award" color="#FFD93D" />
        </View>

        {/* ===== 工具列表 ===== */}
        <View style={s.sectionBlock}>
          <Text style={s.sectionTitle}>学习工具</Text>
          <View style={s.menuCard}>
            <MenuRow
              icon="target" title="我的成就"
              subtitle="查看已解锁的成就和勋章" color={ANCHOR_COLOR}
              onPress={() => router.push('/(tabs)/achievements')}
            />
            <View style={s.divider} />
            <MenuRow
              icon="mic" title="语音偏好设置"
              subtitle="调节语速，按自己的节奏听英语" color="#4A90D9"
              onPress={() => router.push({ pathname: '/(tabs)/settings', params: { type: 'voice' } })}
            />
          </View>
        </View>

        {/* ===== 底部设置 ===== */}
        <View style={s.sectionBlock}>
          <Text style={s.sectionTitle}>系统</Text>
          <View style={s.menuCard}>
            <MenuRow
              icon="settings" title="设置"
              subtitle="应用偏好与数据管理" color="#888"
              onPress={() => router.push('/settings-detail')}
            />
            <View style={s.divider} />
            <MenuRow
              icon="info" title="关于"
              subtitle="LensGo v1.0.0" color="#888"
              onPress={() => Alert.alert('关于', 'LensGo\n版本 1.0.0\n用 AI 让英语学习更有趣')}
            />
          </View>
        </View>
      </ScrollView>

      {/* ===== 勋章解锁弹窗 ===== */}
      <Modal visible={showUnlockModal} transparent animationType="none">
        <View style={s.unlockOverlay}>
          <Animated.View
            style={[
              s.unlockCard,
              {
                transform: [
                  {
                    scale: unlockAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.3, 1],
                    }),
                  },
                ],
                opacity: unlockAnim,
              },
            ]}
          >
            {/* 装饰顶部 */}
            <View style={[s.unlockTopBar, { backgroundColor: unlockBadge?.color || '#FFD93D' }]}>
              <Feather name="award" size={48} color="#fff" />
            </View>

            {/* 勋章图标 */}
            <View style={[s.unlockIconCircle, { borderColor: unlockBadge?.color || '#FFD93D' }]}>
              <Feather
                name={(unlockBadge?.icon as keyof typeof Feather.glyphMap) || 'award'}
                size={40}
                color={unlockBadge?.color || '#FFD93D'}
              />
            </View>

            <Text style={s.unlockTitle}>🎉 恭喜获得新勋章！</Text>
            <Text style={s.unlockBadgeName}>{unlockBadge?.name || ''}</Text>
            <Text style={s.unlockDesc}>{unlockBadge?.description || ''}</Text>

            <TouchableOpacity
              style={[s.unlockBtn, { backgroundColor: unlockBadge?.color || '#FFD93D' }]}
              onPress={handleCloseUnlock}
              activeOpacity={0.8}
            >
              <Text style={s.unlockBtnText}>太棒了！</Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a1a' },
  scroll: { flex: 1 },

  /* ── 顶部个人资料 ── */
  profileSection: { alignItems: 'center', paddingBottom: 8, paddingHorizontal: 20 },
  avatarWrap: { marginBottom: 12 },
  avatar: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: ANCHOR_COLOR,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 4, borderColor: '#fff',
    shadowColor: ANCHOR_COLOR, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 8,
  },
  userName: { fontSize: 24, fontWeight: '700', color: '#FFFFFF', textAlign: 'center' },
  userBio: { fontSize: 14, color: '#BBBBBB', textAlign: 'center', marginTop: 4 },

  /* ── 统计卡片 ── */
  statsRow: {
    flexDirection: 'row', paddingHorizontal: 20, gap: 12,
    marginTop: 20, marginBottom: 20,
  },

  /* ── 工具列表 ── */
  sectionBlock: { paddingHorizontal: 20, marginBottom: 20 },
  sectionTitle: {
    fontSize: 14, fontWeight: '700', color: '#BBBBBB',
    textTransform: 'uppercase', letterSpacing: 1,
    marginBottom: 10, marginLeft: 4,
  },
  menuCard: {
    backgroundColor: '#2a2a2a', borderRadius: 18, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12, shadowRadius: 6, elevation: 2,
  },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.1)', marginLeft: 68 },

  /* ── 勋章解锁弹窗 ── */
  unlockOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  unlockCard: {
    width: '100%',
    backgroundColor: '#2a2a2a',
    borderRadius: 28,
    alignItems: 'center',
    paddingBottom: 32,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
    elevation: 16,
  },
  unlockTopBar: {
    width: '100%',
    height: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unlockIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#2a2a2a',
    borderWidth: 4,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -40,
    marginBottom: 16,
  },
  unlockTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  unlockBadgeName: {
    fontSize: 28,
    fontWeight: '900',
    color: '#FFFFFF',
    marginBottom: 12,
  },
  unlockDesc: {
    fontSize: 14,
    color: '#BBBBBB',
    textAlign: 'center',
    paddingHorizontal: 24,
    lineHeight: 20,
    marginBottom: 24,
  },
  unlockBtn: {
    paddingHorizontal: 48,
    paddingVertical: 14,
    borderRadius: 24,
  },
  unlockBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
