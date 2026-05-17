/**
 * OralHistoryDetailScreen - AI 通话历史对话详情页
 *
 * 功能：
 * - 展示单次通话的所有消息记录
 * - 显示通话时间、时长等元信息
 * - 类似生词本点击跳转详情页的逻辑
 */
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    StatusBar,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getOralMessages, getOralSessions, OralMessage, OralSession } from '../services/oralHistoryService';

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

export default function OralHistoryDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();

  const [session, setSession] = useState<OralSession | null>(null);
  const [messages, setMessages] = useState<OralMessage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sessionId) return;
    (async () => {
      try {
        // 获取会话信息
        const sessions = await getOralSessions();
        const found = sessions.find((s) => s.id === sessionId);
        setSession(found || null);

        // 获取消息列表
        const msgs = await getOralMessages(sessionId);
        setMessages(msgs);
      } catch (err) {
        console.error('[OralHistoryDetail] 加载失败:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [sessionId]);

  const renderMessage = useCallback(({ item }: { item: OralMessage }) => {
    const isUser = item.role === 'user';
    return (
      <View
        style={[
          styles.msgBubble,
          isUser ? styles.msgBubbleUser : styles.msgBubbleAI,
        ]}
      >
        <Text
          style={[
            styles.msgRole,
            isUser ? styles.msgRoleUser : styles.msgRoleAI,
          ]}
        >
          {isUser ? '你' : 'AI 外教'}
        </Text>
        <Text
          style={[
            styles.msgText,
            isUser ? styles.msgTextUser : styles.msgTextAI,
          ]}
        >
          {item.content}
        </Text>
      </View>
    );
  }, []);

  if (loading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <StatusBar barStyle="light-content" />
        <View style={styles.topBar}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
            activeOpacity={0.7}
          >
            <Feather name="arrow-left" size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.topBarTitle}>对话详情</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#A78BFA" />
          <Text style={styles.loadingText}>加载中...</Text>
        </View>
      </View>
    );
  }

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
        <Text style={styles.topBarTitle}>对话详情</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* 会话元信息 */}
      {session && (
        <View style={styles.metaSection}>
          <View style={styles.metaRow}>
            <Feather name="clock" size={14} color="rgba(255,255,255,0.4)" />
            <Text style={styles.metaText}>{formatTime(session.created_at)}</Text>
          </View>
          <View style={styles.metaRow}>
            <Feather name="phone-call" size={14} color="rgba(255,255,255,0.4)" />
            <Text style={styles.metaText}>通话时长 {formatDuration(session.duration_seconds)}</Text>
          </View>
        </View>
      )}

      {/* 消息列表 */}
      {messages.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Feather name="message-square" size={48} color="rgba(255,255,255,0.2)" />
          <Text style={styles.emptyTitle}>暂无消息记录</Text>
        </View>
      ) : (
        <FlatList
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
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

  // ── 会话元信息 ──
  metaSection: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    marginBottom: 8,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  metaText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.5)',
  },

  // ── 空状态 ──
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.4)',
    marginTop: 12,
  },

  // ── 列表 ──
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 32,
    paddingTop: 8,
  },

  // ── 消息气泡 ──
  msgBubble: {
    maxWidth: '85%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    marginBottom: 10,
  },
  msgBubbleAI: {
    backgroundColor: 'rgba(167, 139, 250, 0.12)',
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 4,
  },
  msgBubbleUser: {
    backgroundColor: 'rgba(110, 231, 183, 0.12)',
    alignSelf: 'flex-end',
    borderBottomRightRadius: 4,
  },
  msgRole: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 4,
  },
  msgRoleAI: {
    color: '#A78BFA',
  },
  msgRoleUser: {
    color: '#6EE7B7',
  },
  msgText: {
    fontSize: 14,
    lineHeight: 20,
  },
  msgTextAI: {
    color: '#E2E8F0',
  },
  msgTextUser: {
    color: '#D1FAE5',
  },
});
