/**
 * SearchScreen - 纯净词典查询（仅本地 SQLite 词典）
 *
 * 查询链路：
 *   输入 → 实时模糊联想（SQLite LIKE，英汉双向，前 20 条，带节流）
 *        → 点击联想项 / 按搜索 → SQLite 精确查询
 *        → 本地命中 → 点击跳转 word-detail 展示
 *        → 本地未命中 → 显示"未找到"，不调用 AI
 *
 * 搜索逻辑（v2）：
 *   - 支持英文原词和中文含义双向模糊查询
 *   - 多字段匹配：同时检索 word（英文）和 translation（中文翻译）字段
 *   - 优先级排序：英文完全匹配 > 英文前缀匹配 > 中文包含匹配 > 英文模糊匹配
 *   - 实时搜索带节流（300ms）
 *   - 搜索结果使用 FlatList 可滚动容器
 *
 * 已移除：
 *   - AI 搜索（searchWordDefinition）调用
 *   - AI 思考进度条
 *   - AI 结果展示区域
 *   - AI 扩展查询选项
 */
import { DictResult, exactMatch, fuzzySearch } from '@/services/dictionaryService';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Speech from 'expo-speech';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type SearchState = 'idle' | 'result' | 'not_found' | 'error';

export default function SearchScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);

  const [query, setQuery] = useState('');
  const [state, setState] = useState<SearchState>('idle');

  // 词典查询结果
  const [dictResult, setDictResult] = useState<DictResult | null>(null);
  // 模糊联想列表
  const [suggestions, setSuggestions] = useState<DictResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // 节流 timer
  const throttleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 自动聚焦
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 300);
    return () => clearTimeout(timer);
  }, []);

  // 清理节流
  useEffect(() => {
    return () => {
      if (throttleRef.current) clearTimeout(throttleRef.current);
    };
  }, []);

  // ── 执行模糊搜索（节流 300ms） ──
  const doFuzzySearch = useCallback((text: string) => {
    if (!text.trim()) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    fuzzySearch(text, 20).then(hits => {
      setSuggestions(hits);
      setShowSuggestions(hits.length > 0);
    });
  }, []);

  // ── 实时模糊联想（带节流） ──
  const handleQueryChange = useCallback((text: string) => {
    setQuery(text);
    setDictResult(null);
    setErrorMsg('');
    setState('idle');

    // 清除之前的节流
    if (throttleRef.current) {
      clearTimeout(throttleRef.current);
    }

    if (!text.trim()) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    // 300ms 节流后执行搜索
    throttleRef.current = setTimeout(() => {
      doFuzzySearch(text);
    }, 300);
  }, [doFuzzySearch]);

  // ── 直接导航到单词详情页 ──
  const navigateToWordDetail = useCallback((result: DictResult) => {
    router.push({
      pathname: '/word-detail',
      params: {
        word: result.word,
        phonetic: result.phonetic,
        definition: result.definition,
        translation: result.translation,
        source: 'search',
        from: 'search',
      },
    });
  }, [router]);

  // ── 点击联想项 → SQLite 精确查询 → 直接跳转详情页 ──
  const handleSuggestionPress = useCallback(async (item: DictResult) => {
    setQuery(item.word);
    setShowSuggestions(false);
    setSuggestions([]);

    // SELECT * FROM words WHERE word = ? LIMIT 1
    const full = await exactMatch(item.word);
    if (full) {
      navigateToWordDetail(full);
    } else {
      setErrorMsg('未找到该词');
      setState('error');
    }
  }, [navigateToWordDetail]);

  // ── 执行搜索 → 仅本地 SQLite 查询，无 AI 兜底 ──
  const handleSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;

    setShowSuggestions(false);
    setDictResult(null);
    setErrorMsg('');

    // SELECT * FROM words WHERE word = ? LIMIT 1
    const local = await exactMatch(q);
    if (local) {
      // 本地命中 → 直接跳转详情页
      navigateToWordDetail(local);
      return;
    }

    // 本地无结果 → 显示"未找到"，不再尝试AI
    setState('not_found');
  }, [query, navigateToWordDetail]);

  // ── 发音 ──
  const handleSpeak = useCallback((text: string) => {
    Speech.speak(text, { language: 'en', rate: 0.9, pitch: 1.0 });
  }, []);

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* 搜索框 */}
        <View style={[styles.inputRow, { paddingTop: insets.top + 20, paddingHorizontal: 20 }]}>
          <View style={styles.inputWrapper}>
            <Feather name="search" size={18} color="#999" style={styles.inputIcon} />
            <TextInput
              ref={inputRef}
              style={styles.textInput}
              placeholder="输入英文或中文..."
              placeholderTextColor="#bbb"
              value={query}
              onChangeText={handleQueryChange}
              onSubmitEditing={handleSearch}
              returnKeyType="search"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {query.length > 0 && (
              <TouchableOpacity onPress={() => { setQuery(''); setSuggestions([]); setShowSuggestions(false); setDictResult(null); setErrorMsg(''); setState('idle'); }}>
                <Feather name="x" size={18} color="#ccc" />
              </TouchableOpacity>
            )}
          </View>
          <TouchableOpacity
            style={styles.searchButton}
            onPress={handleSearch}
            activeOpacity={0.7}
          >
            <Text style={styles.searchButtonText}>搜索</Text>
          </TouchableOpacity>
        </View>

        {/* 主内容区：使用 FlatList 统一管理所有可滚动内容 */}
        <FlatList
          style={styles.contentArea}
          contentContainerStyle={styles.contentContainer}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          data={showSuggestions ? suggestions : (dictResult ? [dictResult] : [])}
          keyExtractor={(item, index) => item.word + '-' + index}
          renderItem={({ item }) => {
            // 联想列表模式
            if (showSuggestions) {
              const sug = item as DictResult;
              return (
                <TouchableOpacity
                  style={styles.suggestionItem}
                  onPress={() => handleSuggestionPress(sug)}
                  activeOpacity={0.7}
                >
                  <View style={styles.suggestionLeft}>
                    <Text style={styles.suggestionWord}>{sug.word}</Text>
                    {sug.phonetic ? (
                      <Text style={styles.suggestionPhonetic}>{sug.phonetic}</Text>
                    ) : null}
                  </View>
                  <Text style={styles.suggestionTrans} numberOfLines={1}>
                    {sug.translation || sug.definition}
                  </Text>
                </TouchableOpacity>
              );
            }

            // 词典结果模式
            if (state === 'result' && dictResult) {
              return (
                <View style={styles.resultContainer}>
                  <View style={styles.sourceBadge}>
                    <Text style={styles.sourceBadgeText}>📖 本地词典</Text>
                  </View>
                  <View style={styles.wordRow}>
                    <View style={styles.wordInfo}>
                      <Text style={styles.wordLabel}>{dictResult.word}</Text>
                      {dictResult.phonetic ? (
                        <Text style={styles.wordPhonetic}>{dictResult.phonetic}</Text>
                      ) : null}
                      <Text style={styles.wordTranslation}>{dictResult.translation}</Text>
                    </View>
                    <View style={styles.wordActions}>
                      <TouchableOpacity
                        style={styles.speakButton}
                        onPress={() => handleSpeak(dictResult.word)}
                      >
                        <Feather name="volume-2" size={24} color="#fff" />
                      </TouchableOpacity>
                    </View>
                  </View>

                  {dictResult.definition ? (
                    <View style={styles.section}>
                      <Text style={styles.sectionLabel}>英文释义</Text>
                      <Text style={styles.definitionText}>{dictResult.definition}</Text>
                    </View>
                  ) : null}

                  <TouchableOpacity
                    style={styles.detailButton}
                    onPress={() => navigateToWordDetail(dictResult)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.detailButtonText}>查看详情</Text>
                    <Feather name="arrow-right" size={18} color="#fff" />
                  </TouchableOpacity>
                </View>
              );
            }

            return null;
          }}
          ListEmptyComponent={
            <>
              {/* 空状态 */}
              {state === 'idle' && !showSuggestions && (
                <View style={styles.emptyState}>
                  <View style={styles.emptyIconWrap}>
                    <Feather name="search" size={48} color="#FF6B6B" />
                  </View>
                  <Text style={styles.emptyText}>想学哪个词？随时问我。</Text>
                  <Text style={styles.emptySubText}>输入英文或中文，实时搜索词典</Text>
                </View>
              )}

              {/* 未找到 */}
              {state === 'not_found' && (
                <View style={styles.errorState}>
                  <Feather name="alert-circle" size={40} color="#FF6B6B" />
                  <Text style={styles.errorText}>未找到</Text>
                  <Text style={styles.errorSubText}>本地词库中未收录该词，请检查拼写后重试</Text>
                  <TouchableOpacity style={styles.retryButton} onPress={() => { setQuery(''); setState('idle'); }}>
                    <Text style={styles.retryButtonText}>重新搜索</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* 错误 */}
              {state === 'error' && (
                <View style={styles.errorState}>
                  <Feather name="alert-circle" size={40} color="#FF6B6B" />
                  <Text style={styles.errorText}>{errorMsg || '查询失败'}</Text>
                </View>
              )}
            </>
          }
        />
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212' },
  flex: { flex: 1 },

  // 搜索框
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 12,
  },
  inputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E1E1E',
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 48,
    marginRight: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  inputIcon: { marginRight: 10 },
  textInput: { flex: 1, fontSize: 16, color: '#FFFFFF' },
  searchButton: {
    height: 48,
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: '#FF6B6B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  // 模糊联想
  suggestionsContainer: {
    marginHorizontal: 20,
    backgroundColor: '#1E1E1E',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 8,
    zIndex: 10,
    marginBottom: 4,
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  suggestionLeft: { flexDirection: 'row', alignItems: 'baseline', gap: 10, flex: 1 },
  suggestionWord: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  suggestionPhonetic: { fontSize: 13, color: '#BBBBBB' },
  suggestionTrans: { fontSize: 14, color: '#BBBBBB', flexShrink: 1, maxWidth: '45%', textAlign: 'right' },
  suggestionHighlight: { backgroundColor: '#FF6B6B', color: '#FFFFFF', borderRadius: 2 },

  // 内容区
  contentArea: { flex: 1 },
  contentContainer: { padding: 20, paddingBottom: 40, flexGrow: 1 },

  // 来源标记
  sourceBadge: { marginBottom: 12 },
  sourceBadgeText: { fontSize: 12, fontWeight: '700', color: '#BBBBBB', letterSpacing: 0.5 },

  // 空状态
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  emptyIconWrap: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: 'rgba(255,107,107,0.12)',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 20,
  },
  emptyText: { fontSize: 18, fontWeight: '700', color: '#FFFFFF', marginBottom: 8 },
  emptySubText: { fontSize: 14, color: '#BBBBBB', textAlign: 'center', lineHeight: 20 },

  // 未找到
  errorState: { alignItems: 'center', paddingTop: 60 },
  errorText: { fontSize: 18, fontWeight: '700', color: '#FF6B6B', marginTop: 16, textAlign: 'center' },
  errorSubText: { fontSize: 14, color: '#BBBBBB', marginTop: 8, textAlign: 'center', lineHeight: 20 },
  retryButton: {
    marginTop: 20,
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#FF6B6B',
  },
  retryButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  // 结果
  resultContainer: {},
  wordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  wordInfo: { flex: 1 },
  wordLabel: { fontSize: 32, fontWeight: '800', color: '#FFFFFF' },
  wordPhonetic: { fontSize: 15, color: '#BBBBBB', marginTop: 4, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  wordTranslation: { fontSize: 20, fontWeight: '700', color: '#BBBBBB', marginTop: 4 },
  wordActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  speakButton: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: '#FF6B6B',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#FF6B6B', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
  },

  // 分区
  section: { marginBottom: 20 },
  sectionLabel: {
    fontSize: 14, fontWeight: '700', color: '#999',
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10,
  },
  definitionText: { fontSize: 15, color: '#CCCCCC', lineHeight: 22 },

  // 查看详情按钮
  detailButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#FF6B6B',
    gap: 8,
  },
  detailButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
