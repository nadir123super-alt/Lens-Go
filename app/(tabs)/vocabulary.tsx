/**
 * VocabularyScreen - 独立生词本页面
 *
 * 功能：
 * - 搜索框实时筛选（单词 + 翻译），500+ 词自动防抖
 * - Swipeable 左滑显示红色"删除"按钮
 * - 点击删除按钮弹出二次确认 Alert
 * - 长按快捷删除（保留）
 * - 点击卡片跳转详情页
 */
import { Feather, Ionicons } from '@expo/vector-icons';
import * as Image from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
    Alert,
    Animated,
    FlatList,
    Image as RNImage,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getVocabulary, removeVocabulary, VocabEntry } from '@/services/vocabularyService';

export default function VocabularyScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [list, setList] = useState<VocabEntry[]>([]);
  const [searchText, setSearchText] = useState('');
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const isFirstLoad = useRef(true);

  // ----- 防抖引用 (for 500+ word optimization) -----
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const DEBOUNCE_MS = list.length > 500 ? 300 : 0;

  // 每次聚焦时刷新
  useFocusEffect(
    useCallback(() => {
      loadVocab();
    }, [])
  );

  const loadVocab = async () => {
    try {
      // 每次都从数据库重新加载，确保获取最新数据（包括刚收藏的单词）
      const data = await getVocabulary();
      setList(data);
      // 首次加载完成后触发渐现动画
      if (isFirstLoad.current) {
        isFirstLoad.current = false;
        fadeAnim.setValue(0);
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }).start();
      }
    } catch (error) {
      console.error('[VocabularyScreen] 加载生词本失败:', error);
    }
  };

  // ----- 搜索筛选 -----
  const filteredWords = useMemo(() => {
    if (!searchText.trim()) return list;
    const q = searchText.trim().toLowerCase();
    return list.filter(
      (item) =>
        item.word.toLowerCase().includes(q) ||
        item.translation.toLowerCase().includes(q)
    );
  }, [list, searchText]);

  const handleSearchChange = useCallback(
    (text: string) => {
      if (DEBOUNCE_MS > 0) {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => setSearchText(text), DEBOUNCE_MS);
      } else {
        setSearchText(text);
      }
    },
    [DEBOUNCE_MS]
  );

  // ----- 删除（二次确认） -----
  const handleDelete = useCallback((item: VocabEntry, swipeableRef?: Swipeable | null) => {
    Alert.alert('删除生词', `确定要删除「${item.word}」吗？`, [
      { text: '取消', style: 'cancel', onPress: () => swipeableRef?.close() },
      {
        text: '确定',
        style: 'destructive',
        onPress: async () => {
          try {
            await removeVocabulary(item.id);
            setList((prev) => prev.filter((e) => e.id !== item.id));
          } catch {}
        },
      },
    ]);
  }, []);

  // 长按删除（保留快捷删除，直接弹窗）
  const handleLongPress = useCallback((item: VocabEntry) => {
    Alert.alert('删除生词', `确定要删除「${item.word}」吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '确定',
        style: 'destructive',
        onPress: async () => {
          try {
            await removeVocabulary(item.id);
            setList((prev) => prev.filter((e) => e.id !== item.id));
          } catch {}
        },
      },
    ]);
  }, []);

  // ----- 跳转详情 -----
  const handleCardPress = useCallback((item: VocabEntry) => {
    router.push({
      pathname: '/word-detail',
      params: {
        word: item.word,
        phonetic: '',
        definition: '',
        translation: item.translation,
        source: item.source,
        imagePath: item.imagePath || '',
        usage: item.usage || '',
        from: 'vocabulary',
        phrasesJson: JSON.stringify(item.phrases || []),
      },
    });
  }, [router]);

  // ----- 清空数据库 -----
  const handleClearDatabase = () => {
    Alert.alert('清空生词本', '⚠️ 此操作将永久删除所有生词数据，\n请确认是否继续？', [
      { text: '取消', style: 'cancel' },
      {
        text: '清空并重新测试',
        style: 'destructive',
        onPress: async () => {
          const { clearVocabulary } = await import('@/services/vocabularyService');
          await clearVocabulary();
          setList([]);
          Alert.alert('✅ 已清空', '生词本已清空，可以重新拍照测试了');
        },
      },
    ]);
  };

  // ----- 渲染卡片 -----
  const renderItem = useCallback(
    ({ item }: { item: VocabEntry }) => (
      <VocabCard
        item={item}
        onDelete={handleDelete}
        onLongPress={handleLongPress}
        onPress={handleCardPress}
      />
    ),
    [handleDelete, handleLongPress, handleCardPress]
  );

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>生词本</Text>
          {list.length > 0 && (
            <TouchableOpacity onPress={handleClearDatabase} style={styles.clearBtn}>
              <Text style={styles.clearBtnText}>清空</Text>
            </TouchableOpacity>
          )}
        </View>
        <Text style={styles.headerCount}>{list.length} 个单词</Text>

        {/* ===== 搜索框 ===== */}
        <View style={styles.searchBar}>
          <Feather name="search" size={16} color="#999" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="搜索单词或翻译…"
            placeholderTextColor="#bbb"
            autoCorrect={false}
            autoCapitalize="none"
            clearButtonMode="while-editing"
            onChangeText={handleSearchChange}
            returnKeyType="search"
          />
        </View>
      </View>

      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
        {filteredWords.length === 0 ? (
          <View style={styles.emptyState}>
            {searchText.trim() ? (
              <>
                <Feather name="search" size={48} color="#ccc" />
                <Text style={styles.emptyTitle}>未找到相关单词</Text>
                <Text style={styles.emptySub}>试试其他的关键词</Text>
              </>
            ) : (
              <>
                <View style={styles.emptyIconWrap}>
                  <Ionicons name="book-outline" size={56} color="#FF6B6B" />
                </View>
                <Text style={styles.emptyTitle}>还没有生词</Text>
                <Text style={styles.emptySub}>拍照识别或查词时收藏的单词会出现在这里</Text>
                <TouchableOpacity style={styles.emptyBtn} onPress={() => router.push('/camera')}>
                  <Text style={styles.emptyBtnText}>去拍照识别</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        ) : (
          <FlatList
            data={filteredWords}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          />
        )}
      </Animated.View>
    </View>
  );
}

// ====== 单项卡片（左滑删除 + 紧凑单行布局）======
// 左 50x50 → 中 单词+翻译同行 → 右 ">" 箭头
// Swipeable 包裹：左滑露出红色"删除"按钮
function VocabCard({
  item,
  onDelete,
  onLongPress,
  onPress,
}: {
  item: VocabEntry;
  onDelete: (item: VocabEntry, ref?: Swipeable | null) => void;
  onLongPress: (item: VocabEntry) => void;
  onPress: (item: VocabEntry) => void;
}) {
  const swipeableRef = useRef<Swipeable>(null);
  const scaleAnim = useRef(new Animated.Value(1)).current;

  // 图片存在性检查
  const [imgExists, setImgExists] = useState(false);
  React.useEffect(() => {
    if (item.imagePath) {
      Image.getInfoAsync(item.imagePath).then((info) => setImgExists(info.exists)).catch(() => {});
    }
  }, [item.imagePath]);

  const hasImage = item.source === 'camera' && item.imagePath && imgExists;
  const formattedDate = new Date(item.timestamp).toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
  });

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
          onPress={() => {
            // 触碰反馈
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
            onDelete(item, swipeableRef.current);
          }}
          activeOpacity={0.8}
        >
          <Feather name="trash-2" size={22} color="#fff" />
          <Text style={styles.deleteBtnText}>删除</Text>
        </TouchableOpacity>
      </Animated.View>
    );
  };

  const handleItemLongPress = () => {
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 0.95, duration: 80, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, friction: 4, useNativeDriver: true }),
    ]).start();
    onLongPress(item);
  };

  return (
    <Swipeable
      ref={swipeableRef}
      renderRightActions={renderRightActions}
      overshootRight={false}
      rightThreshold={40}
      onSwipeableOpen={() => {
        // 滑出时轻微震动
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      }}
    >
      <Animated.View style={[styles.card, { transform: [{ scale: scaleAnim }] }]}>
        <TouchableOpacity
          style={styles.cardTouchable}
          onLongPress={handleItemLongPress}
          onPress={() => onPress(item)}
          activeOpacity={0.7}
        >
          {/* 左：缩略图 */}
          <View style={styles.cardLeft}>
            {hasImage ? (
              <RNImage source={{ uri: item.imagePath }} style={styles.cardThumb} />
            ) : (
              <View
                style={[
                  styles.cardThumbIcon,
                  { backgroundColor: item.source === 'camera' ? '#FF6B6B' : '#4A90D9' },
                ]}
              >
              <Ionicons
                  name={item.source === 'camera' ? 'camera-outline' : 'search-outline'}
                  size={20}
                  color="#fff"
                />
              </View>
            )}
          </View>

          {/* 中：单词+翻译 */}
          <View style={styles.cardCenter}>
            <View style={styles.cardWordRow}>
              <Text style={styles.cardWord} numberOfLines={1}>
                {item.word}
              </Text>
              <Text style={styles.cardTrans} numberOfLines={1} ellipsizeMode="tail">
                {item.translation}
              </Text>
            </View>
            <View style={styles.cardMeta}>
              <View style={styles.sourceDot}>
                <Text style={styles.sourceDotText}>
                  {item.source === 'camera' ? '📷' : '🔍'}
                </Text>
              </View>
              <Text style={styles.cardTime}>{formattedDate}</Text>
            </View>
          </View>

          {/* 右：">" */}
          <Feather name="chevron-right" size={18} color="#ccc" style={styles.cardArrow} />
        </TouchableOpacity>
      </Animated.View>
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212' },

  // ===== 顶部 =====
  header: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    backgroundColor: '#121212',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerTitle: { fontSize: 28, fontWeight: '800', color: '#FFFFFF' },
  headerCount: { fontSize: 14, color: '#BBBBBB', marginTop: 4, marginBottom: 10 },
  clearBtn: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  clearBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },

  // ===== 搜索框 =====
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E1E1E',
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 38,
  },
  searchIcon: { marginRight: 6 },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#FFFFFF',
    paddingVertical: 0,
  },

  // ===== 空状态 =====
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  emptyIconWrap: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(255,107,107,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#FFFFFF', marginBottom: 8 },
  emptySub: {
    fontSize: 14,
    color: '#BBBBBB',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  emptyBtn: {
    backgroundColor: '#FF6B6B',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
  },
  emptyBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  // ===== 列表 =====
  listContent: { paddingHorizontal: 12, paddingVertical: 8, paddingBottom: 40 },

  // ===== 卡片 =====
  card: {
    backgroundColor: '#262626',
    borderRadius: 12,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 2,
  },
  cardTouchable: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
  },

  // ===== 左：缩略图 50x50 =====
  cardLeft: { marginRight: 12 },
  cardThumb: { width: 50, height: 50, borderRadius: 10, backgroundColor: '#333' },
  cardThumbIcon: {
    width: 50,
    height: 50,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ===== 中：文字 =====
  cardCenter: { flex: 1, justifyContent: 'center' },
  cardWordRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardWord: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
    flexShrink: 0,
  },
  cardTrans: { 
    fontSize: 14, 
    color: '#BBBBBB', 
    flexShrink: 1,
    maxWidth: 180,
  },
  cardMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 6 },
  sourceDot: {
    backgroundColor: 'rgba(255,107,107,0.12)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  sourceDotText: { fontSize: 11, color: '#FF6B6B', fontWeight: '600' },
  cardTime: { fontSize: 11, color: '#BBBBBB' },

  // ===== 右：箭头 =====
  cardArrow: { marginLeft: 8 },

  // ===== 滑动删除区 =====
  deleteAction: {
    width: 80,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  deleteBtn: {
    flex: 1,
    width: '100%',
    backgroundColor: '#FF3B30',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  deleteBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
