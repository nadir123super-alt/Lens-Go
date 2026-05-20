/**
 * EvaluationSummaryView — 口语练习成绩页面（Tab 容器内）
 *
 * 设计规范：
 *   - 无返回箭头、无圆形装饰图标（顶部仅标题文字）
 *   - 底部 Tab Bar 始终可见（继承自 Tab Navigator）
 *   - 无"返回首页"按钮（用户通过 Tab 切换离开）
 *   - 卡片内布局：图标缩小、标题/分数字号缩小、整体上移
 *   - "再练一组"按钮嵌入在卡片内部，位于平均分正下方
 */

import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useGlobalSpeech } from '@/hooks/useGlobalSpeech';
import { usePracticeContext } from '@/services/practiceContext';
import {
  getAverageScore,
  getScoreFeedback,
  isAllPerfect
} from '@/services/practiceService';

const ANCHOR = '#FF6B6B';

export default function EvaluationSummaryScreen() {
  const insets = useSafeAreaInsets();
  const { lastScores, resetPractice } = usePracticeContext();
  const { stop: stopGlobalSpeech } = useGlobalSpeech();

  // ★ 页面失去焦点时（切换到其他 Tab）立即停止所有音频播放
  useFocusEffect(
    useCallback(() => {
      return () => {
        console.log('[evaluation-summary] 🚫 页面失去焦点，停止音频播放');
        stopGlobalSpeech();
      };
    }, [stopGlobalSpeech])
  );

  // 直接从 Context 读取成绩，不依赖组件内临时内存
  const scores = lastScores;
  const avgScore = getAverageScore(scores);
  const perfect = isAllPerfect(scores);

  const handleRestart = async () => {
    stopGlobalSpeech();

    // 预取新一组单词（优先未评测，次之低分）
    try {
      const { fetchNextPracticeSet, setPendingSession } = await import(
        '@/services/practiceService'
      );
      const nextSession = await fetchNextPracticeSet();
      setPendingSession(nextSession);
      console.log('[evaluation-summary] ✅ 已预取新练习单词，共', nextSession.words.length, '个');
    } catch (err) {
      console.warn('[evaluation-summary] ⚠️ 预取下一组单词失败，将在 initSession 中重试:', err);
    }

    // 3. 重置 Context → isPracticeFinished=false + practiceVersion++
    // PracticeTab 检测到变化 → 自动切换为 PracticeScreen（因 key 变化完全重挂载）
    // PracticeScreen 的 initSession 会自动 consumePendingSession 读取预取数据
    resetPractice();
    console.log('[evaluation-summary] 🔄 已重置练习状态，PracticeTab 将自动切换为练习界面');
  };

  if (scores.length === 0) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 20 }]}>
        <StatusBar style="light" />
        <View style={styles.topBar}>
          <View style={styles.topBarSpacer} />
          <Text style={styles.topTitle}>成绩详情</Text>
          <View style={styles.topBarSpacer} />
        </View>
        <View style={styles.centerContent}>
          <Feather name="file-text" size={56} color="rgba(255,255,255,0.3)" />
          <Text style={styles.emptyTitle}>暂无成绩数据</Text>
          <Text style={styles.emptySub}>完成一轮口语练习后可以在这里查看成绩</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={handleRestart}>
            <Feather name="mic" size={18} color="#fff" />
            <Text style={styles.primaryBtnText}>开始练习</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top + 20 }]}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      <StatusBar style="light" />

      {/* 顶部栏：仅标题，无返回箭头，无装饰图标 */}
      <View style={styles.topBar}>
        <View style={styles.topBarSpacer} />
        <Text style={styles.topTitle}>成绩详情</Text>
        <View style={styles.topBarSpacer} />
      </View>

      {/* 成绩概览卡片——所有元素垂直排列，按钮嵌入卡片内 */}
      <View style={styles.summaryCard}>
        <View style={styles.summaryIcon}>
          <Feather
            name={perfect ? 'award' : 'check-circle'}
            size={40}
            color={perfect ? '#FFD700' : '#34C759'}
          />
        </View>
        <Text style={styles.summaryTitle}>练习完成！</Text>
        <Text style={styles.summaryScore}>
          平均分 {avgScore} {perfect ? '🏆' : ''}
        </Text>
        {perfect && (
          <Text style={styles.perfectBadge}>今日口语任务达成！</Text>
        )}

        {/* 卡片内嵌"再练一组"按钮 */}
        <TouchableOpacity style={styles.cardPrimaryBtn} onPress={handleRestart}>
          <Feather name="refresh-cw" size={16} color="#fff" />
          <Text style={styles.cardPrimaryBtnText}>再练一组</Text>
        </TouchableOpacity>
      </View>

      {/* 详细得分列表 */}
      <View style={styles.scoreList}>
        {scores.map((s, i) => {
          const wFb = getScoreFeedback(s.wordScore);
          const sFb = getScoreFeedback(s.sentenceScore);
          return (
            <View key={s.id || i} style={styles.scoreCard}>
              <Text style={styles.scoreWord}>{s.word}</Text>
              <View style={styles.scoreRow}>
                <Text style={styles.scoreStageLabel}>单词发音</Text>
                <View style={styles.scoreValueRow}>
                  <View
                    style={[styles.scoreDot, { backgroundColor: wFb.color }]}
                  />
                  <Text style={[styles.scoreValue, { color: wFb.color }]}>
                    {s.wordScore}
                  </Text>
                  <Text style={styles.scoreLevelText}>{wFb.level}</Text>
                </View>
              </View>
              {s.sentenceScore > 0 && (
                <View style={styles.scoreRow}>
                  <Text style={styles.scoreStageLabel}>例句发音</Text>
                  <View style={styles.scoreValueRow}>
                    <View
                      style={[styles.scoreDot, { backgroundColor: sFb.color }]}
                    />
                    <Text style={[styles.scoreValue, { color: sFb.color }]}>
                      {s.sentenceScore}
                    </Text>
                    <Text style={styles.scoreLevelText}>{sFb.level}</Text>
                  </View>
                </View>
              )}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a1a' },
  scrollContent: { flexGrow: 1, paddingBottom: 40 },

  // 顶部：纯文字标题，无图标
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  topBarSpacer: {
    width: 44,
    height: 44,
  },
  topTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    flex: 1,
    textAlign: 'center',
  },

  // 成绩概览卡片 — flex column 布局，元素上移，按钮内嵌
  summaryCard: {
    flexDirection: 'column',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 24,
    paddingHorizontal: 24,
    marginHorizontal: 20,
    marginBottom: 20,
    backgroundColor: '#2a2a2a',
    borderRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  summaryIcon: {
    // 缩小了对勾图标（40px vs 之前56px）
  },
  summaryTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#fff',
  },
  summaryScore: {
    fontSize: 17,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.7)',
  },
  perfectBadge: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFD700',
    backgroundColor: 'rgba(255,215,0,0.12)',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    overflow: 'hidden',
  },

  // 卡片内嵌的"再练一组"按钮
  cardPrimaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ANCHOR,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 40,
    gap: 8,
    width: '100%',
    marginTop: 4,
  },
  cardPrimaryBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },

  // 得分列表
  scoreList: {
    marginHorizontal: 20,
    marginBottom: 24,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 16,
    padding: 16,
  },
  scoreCard: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  scoreWord: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 8,
  },
  scoreRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  scoreStageLabel: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.5)',
  },
  scoreValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  scoreDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  scoreValue: {
    fontSize: 18,
    fontWeight: '800',
    minWidth: 28,
    textAlign: 'right',
  },
  scoreLevelText: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.4)',
  },

  // 空状态
  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#fff',
    marginTop: 20,
    marginBottom: 8,
  },
  emptySub: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: ANCHOR,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 28,
    gap: 8,
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});
