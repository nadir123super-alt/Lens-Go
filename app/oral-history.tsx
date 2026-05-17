import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
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

export default function OralHistoryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [sessions, setSessions] = useState<OralSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, OralMessage[]>>({});
  const [loadingMessages, setLoadingMessages] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    const data = await getOralSessions();
    setSessions(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const toggleExpand = useCallback(async (sessionId: string) => {
    if (expandedId === sessionId) {
      setExpandedId(null);
      return;
    }

    setExpandedId(sessionId);

    if (!messages[sessionId]) {
      setLoadingMessages(sessionId);
      const msgs = await getOralMessages(sessionId);
      setMessages((prev) => ({ ...prev, [sessionId]: msgs }));
      setLoadingMessages(null);
    }
  }, [expandedId, messages]);

  const renderMessage = (msg: OralMessage, index: number) => {
    const isUser = msg.role === 'user';

    return (
      <View
        key={index}
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
          {msg.content}
        </Text>
      </View>
    );
  };

  const renderSession = ({ item }: { item: OralSession }) => {
    const isExpanded = expandedId === item.id;
    const sessionMessages = messages[item.id] || [];

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => toggleExpand(item.id)}
        activeOpacity={0.7}
      >
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <Feather name="phone-call" size={16} color="#A78BFA" />
            <Text style={styles.cardTime}>{formatTime(item.created_at)}</Text>
          </View>
          <View style={styles.cardHeaderRight}>
            <Text style={styles.cardDuration}>{formatDuration(item.duration_seconds)}</Text>
            <Feather
              name={isExpanded ? 'chevron-up' : 'chevron-down'}
              size={18}
              color="rgba(255,255,255,0.4)"
            />
          </View>
        </View>

        <View style={styles.cardMeta}>
          <Text style={styles.cardMetaText}>
            {'通话时长 ' + formatDuration(item.duration_seconds)}
          </Text>
        </View>

        {isExpanded && (
          <View style={styles.messagesContainer}>
            {loadingMessages === item.id ? (
              <ActivityIndicator size="small" color="#A78BFA" style={{ marginVertical: 16 }} />
            ) : sessionMessages.length > 0 ? (
              sessionMessages.map((msg, idx) => renderMessage(msg, idx))
            ) : (
              <Text style={styles.emptyMsg}>暂无消息记录</Text>
            )}
          </View>
        )}
      </TouchableOpacity>
    );
  };

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
        <View style={{ width: 40 }} />
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
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(167, 139, 250, 0.15)',
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

  // ── 消息容器 ──
  messagesContainer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
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
  emptyMsg: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.3)',
    textAlign: 'center',
    paddingVertical: 16,
  },
});
