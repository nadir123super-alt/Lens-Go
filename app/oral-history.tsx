/**
 * OralHistoryScreen - AI 通话历史记录列表页
 *
 * 功能：
 * - 点击卡片跳转 oral-history-detail 详情页（类似生词本点击跳转 word-detail）
 * - Swipeable 左滑显示红色"删除"按钮（跟生词本一样）
 * - 点击删除按钮弹出二次确认 Alert
 */
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Animated,
    FlatList,
    StatusBar,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { clearAllOralSessions, deleteOralSession, getOralSessions, OralSession } from '../services/oralHistoryService';

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return y + '-' + m + '-' + day + ' ' + h + ':' + min;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m > 0) return m + '分' + s + '秒';
  return s + '秒';
}

export default function OralHistoryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [sessions, setSessions] = useState<OralSession[]>([]);
  const [loading, setLoading] = useState(true);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    const data = await getOralSessions();
    setSessions(data);
    setLoading(false);
  }, []);

  // 每次页面聚焦时刷新（类似生词本 useFocusEffect）
  useFocusEffect(
    useCallback(() => {
      loadSessions();
    }, [loadSessions])
  );

  // ── 点击卡片跳转详情页 ──
  const handleCardPress = useCallback((item: OralSession) => {
    router.push({
      pathname: '/oral-history-detail',
      params: { sessionId: item.id },
    });
  }, [router]);

  // ── 删除（二次确认） ──
  const handleDelete = useCallback((item: OralSession, swipeableRef?: Swipeable | null) => {
    Alert.alert(
      '删除记录',
      '确定要删除这条通话记录吗？删除后无法恢复。',
      [
        { text: '取消', style: 'cancel', onPress: () => swipeableRef?.close() },
        {
          text: '删除',
          style: 'destructive',
          onPress: async () => {
            // 1. 先立即从本地状态移除（不刷新页面）
            setSessions((prev) => prev.filter((s) => s.id !== item.id));
            
            // 2. 后台执行数据库删除（不阻塞 UI，不显示加载）
            const success = await deleteOralSession(item.id);
            if (!success) {
              // 删除失败，恢复显示并提示用户
              setSessions((prev) => [...prev, item]);
              Alert.alert('删除失败', '请稍后重试');
            }
          },
        },
      ]
    );
  }, []);

  // ── 一键清空所有记录 ──
  const handleClearAll = useCallback(() => {
    Alert.alert('清空历史对话', '⚠️ 此操作将永久删除所有通话记录，\n请确认是否继续？', [
      { text: '取消', style: 'cancel' },
      {
        text: '清空',
        style: 'destructive',
        onPress: async () => {
          // 1. 先立即清空本地状态（不刷新页面）
          setSessions([]);
          
          // 2. 后台执行数据库清空（不阻塞 UI，不显示加载）
          const success = await clearAllOralSessions();
          if (!success) {
            // 清空失败，重新加载数据
            await loadSessions();
            Alert.alert('清空失败', '请稍后重试');
          }
        },
      },
    ]);
  }, [loadSessions]);

  // ── 渲染卡片 ──
  const renderSession = useCallback(
    ({ item }: { item: OralSession }) => (
      <OralSessionCard
        item={item}
        onPress={handleCardPress}
        onDelete={handleDelete}
      />
    ),
    [handleCardPress, handleDelete]
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" />

      {/* 顶部导航栏 */}
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <Feather name="arrow-left" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>历史对话</Text>
        {sessions.length > 0 && (
          <TouchableOpacity
            style={styles.clearButton}
            onPress={handleClearAll}
            activeOpacity={0.7}
          >
            <Feather name="trash-2" size={18} color="#EF4444" />
          </TouchableOpacity>
        )}
      </View>

      {/* 内容区域 */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#A78BFA" />
          <Text style={styles.loadingText}>加载中...</Text>
        </View>
      ) : sessions.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Feather name="clock" size={48} color="rgba(255,255,255,0.2)" />
          <Text style={styles.emptyTitle}>暂无通话记录</Text>
          <Text style={styles.emptySubtitle}>开始一次 AI 口语对话吧</Text>
        </View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(item) => item.id}
          renderItem={renderSession}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

// ====== 单项卡片（Swipeable 左滑删除）======
// 跟生词本 VocabCard 一样的 Swipeable 左滑删除逻辑
function OralSessionCard({
  item,
  onPress,
  onDelete,
}: {
  item: OralSession;
  onPress: (item: OralSession) => void;
  onDelete: (item: OralSession, ref?: Swipeable | null) => void;
}) {
  const swipeableRef = useRef<Swipeable>(null);

  // 右侧操作区：红色"删除"按钮
  const renderRightActions = (
    _progress: Animated.AnimatedInterpolation<number>,
    dragX: Animated.AnimatedInterpolation<number>
  ) => {
    const translateX = dragX.interpolate({
      inputRange: [-80, 0],
      outputRange: [0, 80],
      extrapolate: 'clamp',
    });

    return (
      <Animated.View style={[styles.deleteAction, { transform: [{ translateX }] }]}>
        <TouchableOpacity
          style={styles.deleteBtn}
          onPress={() => onDelete(item, swipeableRef.current)}
          activeOpacity={0.8}
        >
          <Feather name="trash-2" size={22} color="#fff" />
          <Text style={styles.deleteBtnText}>删除</Text>
        </TouchableOpacity>
      </Animated.View>
    );
  };

  return (
    <Swipeable
      ref={swipeableRef}
      renderRightActions={renderRightActions}
      overshootRight={false}
      rightThreshold={40}
    >
      <TouchableOpacity
        style={styles.card}
        onPress={() => onPress(item)}
        activeOpacity={0.7}
      >
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <Feather name="phone-call" size={16} color="#A78BFA" />
            <Text style={styles.cardTime}>{formatTime(item.created_at)}</Text>
          </View>
          <View style={styles.cardHeaderRight}>
            <Text style={styles.cardDuration}>{formatDuration(item.duration_seconds)}</Text>
            <Feather name="chevron-right" size={18} color="rgba(255,255,255,0.3)" />
          </View>
        </View>

        <View style={styles.cardMeta}>
          <Text style={styles.cardMetaText}>
            通话时长 {formatDuration(item.duration_seconds)}
          </Text>
        </View>
      </TouchableOpacity>
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },

  // ── 顶部栏 ──
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
  clearButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(239,68,68,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── 加载状态 ──
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.5)',
    marginTop: 12,
  },

  // ── 空状态 ──
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.5)',
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.3)',
    marginTop: 8,
  },

  // ── 列表 ──
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },

  // ── 卡片 ──
  card: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(167, 139, 250, 0.15)',
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardTime: {
    fontSize: 15,
    fontWeight: '600',
    color: '#E2E8F0',
  },
  cardDuration: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.4)',
  },
  cardMeta: {
    marginTop: 8,
  },
  cardMetaText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.35)',
  },

  // ── Swipeable 删除按钮 ──
  deleteAction: {
    marginBottom: 12,
    width: 80,
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteBtn: {
    backgroundColor: '#EF4444',
    borderRadius: 16,
    width: 80,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'column',
    gap: 4,
  },
  deleteBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
});
