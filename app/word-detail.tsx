/**
 * WordDetailScreen - 单词详情页（按来源区分收藏按钮）
 *
 * 来源判定（通过路由参数 from）：
 *   - from='search'（词典查询）→ 显示 ★ 收藏按钮
 *   - from='vocabulary'（生词本列表）→ 隐藏收藏按钮，纯查看
 *
 * 收藏逻辑（来源 A）：
 *   - 点击 ★ 按钮 → 自动调用 toggleFavorite → 自动生成例句（sentenceGenerator）
 *   - 收藏成功：★ 变实心（黄色），显示 toast "已收藏"
 *   - 取消收藏：★ 变空心（白色），显示 toast "已取消收藏"
 *
 * 例句：
 *   - 生词本来源：展示数据库中的例句（通过 phrasesJson 传入）
 *   - 词典来源：不显示例句（收藏后例句会保存到生词本）
 *   - 所有例句经过 normalizeSentence 标准化（仅首字母大写）
 *
 * 数据清洗与排版优化：
 *   - 中文释义按词性分段显示（n./v./a./adv./prep./conj./pron./num./art./int.）
 *   - 词性标签用彩色小 badge 包裹（淡蓝/淡紫/淡橙等）
 *   - 英文释义清洗 \n 换行符，设置 1.5 倍行高
 *   - 提取 [计] [医] [法] 等领域标签
 */
import { playText, cleanup as soundCleanup } from '@/services/soundManager';
import { isWordFavorited, toggleFavorite } from '@/services/vocabularyService';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const ANCHOR = '#FF6B6B';
const FAVORITE_YELLOW = '#FFD700';

interface PhraseItem {
  e: string;
  c: string;
}

interface TranslationSection {
  pos: string | null;
  posLabel: string | null;
  posColor: string;
  posBg: string;
  meanings: string[];
  fieldTag: string | null;
}

const TOAST_DURATION = 2000;

// ====== 词性标签配置 ======
const POS_TAGS: Record<string, { label: string; color: string; bg: string }> = {
  'n':     { label: '名词',       color: '#4A9EFF', bg: 'rgba(74,158,255,0.15)' },
  'v':     { label: '动词',       color: '#FF6B9D', bg: 'rgba(255,107,157,0.15)' },
  'vi':    { label: '不及物动词', color: '#FF6B9D', bg: 'rgba(255,107,157,0.15)' },
  'vt':    { label: '及物动词',   color: '#FF6B9D', bg: 'rgba(255,107,157,0.15)' },
  'aux':   { label: '助动词',     color: '#FF6B9D', bg: 'rgba(255,107,157,0.15)' },
  'a':     { label: '形容词',     color: '#FFB84D', bg: 'rgba(255,184,77,0.15)' },
  'adj':   { label: '形容词',     color: '#FFB84D', bg: 'rgba(255,184,77,0.15)' },
  'ad':    { label: '形容词',     color: '#FFB84D', bg: 'rgba(255,184,77,0.15)' },
  'adv':   { label: '副词',       color: '#A66CFF', bg: 'rgba(166,108,255,0.15)' },
  'prep':  { label: '介词',       color: '#4DD9B6', bg: 'rgba(77,217,182,0.15)' },
  'conj':  { label: '连词',       color: '#FF8C5A', bg: 'rgba(255,140,90,0.15)' },
  'pron':  { label: '代词',       color: '#5AE0C0', bg: 'rgba(90,224,192,0.15)' },
  'num':   { label: '数词',       color: '#FFD93D', bg: 'rgba(255,217,61,0.15)' },
  'art':   { label: '冠词',       color: '#6BCB77', bg: 'rgba(107,203,119,0.15)' },
  'int':   { label: '感叹词',     color: '#FF6B6B', bg: 'rgba(255,107,107,0.15)' },
  'det':   { label: '限定词',     color: '#6BCB77', bg: 'rgba(107,203,119,0.15)' },
  'modal': { label: '情态动词',   color: '#FF6B9D', bg: 'rgba(255,107,157,0.15)' },
};

// 词性缩写正则（匹配行首的 pos 标记）
const POS_PATTERN = /^(n\.|v\.|vi\.|vt\.|aux\.|a\.|adj\.|ad\.|adv\.|prep\.|conj\.|pron\.|num\.|art\.|int\.|det\.|modal\.)\s*/i;

// 领域标签正则
const FIELD_PATTERN = /\[(计|医|法|物|化|生|数|经|哲|心|政|社|文|艺|体|电|机|建|矿|冶|纺|农|林|渔|商|军|宗|语|音|美|史|地|天|气|海|航|交|邮|纺|食|工|能|环|水|牧|兽|园|林|测|绘|光|磁|半|微|生|遗|基|细|免|分|解|生|神|药|毒|营|营|营)]/;

// ====== 数据清洗工具函数 ======

/** 清洗字符串中的 \n 和 \nn 为真正的换行符 */
function cleanNewlines(text: string): string {
  return text.replace(/\\n+/g, '\n').replace(/\n{2,}/g, '\n');
}

/** 解析中文释义，按词性分段 */
function parseTranslationSections(translation: string): TranslationSection[] {
  const cleaned = cleanNewlines(translation);
  const lines = cleaned.split('\n').filter(l => l.trim().length > 0);
  const sections: TranslationSection[] = [];

  let currentSection: TranslationSection | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    
    // 检测领域标签 [计] [医] 等
    const fieldMatch = trimmed.match(FIELD_PATTERN);
    const fieldTag = fieldMatch ? fieldMatch[1] : null;

    // 检测词性标签
    const posMatch = trimmed.match(POS_PATTERN);
    if (posMatch) {
      // 保存上一段
      if (currentSection) {
        sections.push(currentSection);
      }
      const posKey = posMatch[1].toLowerCase().replace('.', '');
      const posConfig = POS_TAGS[posKey] || { label: posKey, color: '#999', bg: 'rgba(255,255,255,0.08)' };
      
      // 提取词性后的释义内容
      const meaningText = trimmed.replace(posMatch[0], '').trim();
      const meanings = meaningText
        .replace(/^[；;]\s*/, '')
        .split(/[；;]/)
        .map(m => m.trim())
        .filter(m => m.length > 0);

      currentSection = {
        pos: posKey,
        posLabel: posConfig.label,
        posColor: posConfig.color,
        posBg: posConfig.bg,
        meanings: meanings.length > 0 ? meanings : [meaningText],
        fieldTag,
      };
    } else if (currentSection) {
      // 续接上一段的释义（同一词性的多个义项）
      const additional = trimmed
        .replace(/^[；;]\s*/, '')
        .split(/[；;]/)
        .map(m => m.trim())
        .filter(m => m.length > 0);
      currentSection.meanings.push(...additional);
    } else {
      // 无词性标记的行，作为无词性段落
      if (currentSection) {
        sections.push(currentSection);
      }
      currentSection = {
        pos: null,
        posLabel: null,
        posColor: '#999',
        posBg: 'rgba(255,255,255,0.06)',
        meanings: [trimmed.replace(/^[；;]\s*/, '')],
        fieldTag,
      };
    }
  }

  if (currentSection) {
    sections.push(currentSection);
  }

  return sections;
}

/** 清洗英文释义中的 \n，返回分段数组 */
function parseDefinitionLines(definition: string): string[] {
  const cleaned = cleanNewlines(definition);
  return cleaned
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);
}

// ====== 子组件：词性标签 Badge ======
function PosBadge({ label, color, bg }: { label: string; color: string; bg: string }) {
  return (
    <View style={[styles.posBadge, { backgroundColor: bg, borderColor: color }]}>
      <Text style={[styles.posBadgeText, { color }]}>{label}</Text>
    </View>
  );
}

// ====== 子组件：领域标签 ======
function FieldTag({ tag }: { tag: string }) {
  const tagMap: Record<string, string> = {
    '计': '计算机', '医': '医学', '法': '法律', '物': '物理', '化': '化学',
    '生': '生物', '数': '数学', '经': '经济', '哲': '哲学', '心': '心理',
    '政': '政治', '社': '社会', '文': '文学', '艺': '艺术', '体': '体育',
    '电': '电子', '机': '机械', '建': '建筑', '音': '音乐', '美': '美术',
    '史': '历史', '地': '地理', '天': '天文', '气': '气象', '海': '海洋',
    '军': '军事', '宗': '宗教', '语': '语言',
  };
  const label = tagMap[tag] || tag;
  return (
    <View style={styles.fieldTag}>
      <Text style={styles.fieldTagText}>{label}</Text>
    </View>
  );
}

const DashedWords = ({text, style}: {text: string; style?: any}) => {
  const cleanedText = text.replace(/_/g, '').trim().replace(/\s+/g, ' ');
  let words = cleanedText.split(' ');
  if (words.length === 1 && cleanedText.length > 1) {
    words = cleanedText.split('');
  }
  const borderColor = 'rgba(255, 255, 255, 0.3)';

  const isPunctuationOnly = (word: string) => /^[。,.!?？！，]+$/.test(word);

  return (
    <View style={{flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', width: '100%'}}>
      {words.map((word, i) => {
        const hasBorder = !isPunctuationOnly(word);
        return (
          <View
            key={i}
            style={{
              alignSelf: 'flex-start',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: 20,
              paddingBottom: hasBorder ? 2 : 0,
              marginRight: 10,
              marginBottom: 12,
              ...(hasBorder && {
                borderBottomWidth: 1.5,
                borderStyle: 'solid',
                borderBottomColor: borderColor,
              }),
            }}
          >
            <Text style={[style, {textAlign: 'center'}]}>{word}</Text>
          </View>
        );
      })}
    </View>
  );
};

export default function WordDetailScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    word: string;
    phonetic: string;
    definition: string;
    translation: string;
    source: string;
    from: string;            // 'search' | 'vocabulary'
    usage?: string;
    imagePath?: string;
    phrasesJson?: string;
  }>();

  const word = params.word || '';
  const phonetic = params.phonetic || '';
  const definition = params.definition || '';
  const translation = params.translation || '';
  const from = params.from || 'search'; // 默认视为词典查询

  // 是否为生词本来源
  const isFromVocabulary = from === 'vocabulary';

  const [phrases, setPhrases] = useState<PhraseItem[]>([]);
  const [isFavorited, setIsFavorited] = useState(false);
  const [favoriteLoading, setFavoriteLoading] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // ====== 数据清洗：解析中文释义和英文释义 ======
  const parsedTranslation = useMemo(
    () => translation ? parseTranslationSections(translation) : [],
    [translation]
  );
  const parsedDefinition = useMemo(
    () => definition ? parseDefinitionLines(definition) : [],
    [definition]
  );

  // "退出即停"：页面卸载时自动停止所有音频
  useEffect(() => {
    return () => {
      soundCleanup();
    };
  }, []);

  // 加载例句（从传入参数读取）
  useEffect(() => {
    if (params.phrasesJson) {
      try {
        const parsed = JSON.parse(params.phrasesJson);
        if (Array.isArray(parsed)) {
          setPhrases(parsed);
        }
      } catch {}
    }
  }, [params.phrasesJson]);

  // 检查初始收藏状态（从词典查询进入时）
  useEffect(() => {
    if (!isFromVocabulary && word) {
      isWordFavorited(word).then(setIsFavorited);
    }
  }, [word, isFromVocabulary]);

  // toast 自动消失
  useEffect(() => {
    if (toastMsg) {
      const t = setTimeout(() => setToastMsg(null), TOAST_DURATION);
      return () => clearTimeout(t);
    }
  }, [toastMsg]);

  // "即点即停"
  const handleSpeak = useCallback((text: string) => {
    playText(text);
  }, []);

  // 收藏切换
  const handleFavorite = useCallback(async () => {
    if (favoriteLoading || !word) return;
    setFavoriteLoading(true);
    try {
      const nowFavorited = await toggleFavorite(word, translation, [], 'search');
      setIsFavorited(nowFavorited);
      setToastMsg(nowFavorited ? '已收藏' : '已取消收藏');
    } catch (err) {
      console.error('[WordDetail] 收藏失败:', err);
      setToastMsg('操作失败，请重试');
    } finally {
      setFavoriteLoading(false);
    }
  }, [favoriteLoading, word, translation]);

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Toast */}
      {toastMsg && (
        <View style={[styles.toastContainer, { paddingTop: insets.top + 16 }]}>
          <View style={styles.toastBox}>
            <Feather
              name={toastMsg === '已收藏' ? 'star' : 'star'}
              size={18}
              color={FAVORITE_YELLOW}
            />
            <Text style={styles.toastText}>{toastMsg}</Text>
          </View>
        </View>
      )}

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* 顶部导航 */}
        <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
          {/* 返回按钮 - 始终显示 */}
          <View style={styles.topBarLeft}>
            <TouchableOpacity
              style={styles.backBtn}
              onPress={() => {
                try { require('expo-router').router.back(); } catch {}
              }}
            >
              <Feather name="arrow-left" size={24} color="#fff" />
            </TouchableOpacity>
          </View>
          <Text style={styles.topBarTitle}>单词详情</Text>
          <View style={styles.topBarRight}>
            {/* 词典来源显示收藏按钮 */}
            {!isFromVocabulary && (
              <TouchableOpacity
                style={styles.favBtn}
                onPress={handleFavorite}
                activeOpacity={0.7}
                disabled={favoriteLoading}
              >
                {favoriteLoading ? (
                  <ActivityIndicator size="small" color={FAVORITE_YELLOW} />
                ) : (
                  <Feather
                    name={isFavorited ? 'star' : 'star'}
                    size={26}
                    color={isFavorited ? FAVORITE_YELLOW : 'rgba(255,255,255,0.6)'}
                  />
                )}
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* 核心信息区 */}
        <View style={styles.coreSection}>
          {/* 单词 + 发音按钮（水平排列） */}
          <View style={styles.wordRow}>
            <Text style={styles.wordText}>{word}</Text>
            <TouchableOpacity style={styles.speakInlineBtn} onPress={() => handleSpeak(word)}>
              <Feather name="volume-2" size={20} color="#fff" />
            </TouchableOpacity>
          </View>

          {/* 音标 */}
          {phonetic ? <Text style={styles.phoneticText}>{phonetic}</Text> : null}

          {/* 中文释义 - 按词性分段显示 */}
          {parsedTranslation.length > 0 ? (
            <View style={styles.translationSection}>
              {parsedTranslation.map((sec, idx) => (
                <View key={idx} style={styles.translationRow}>
                  {/* 领域标签 */}
                  {sec.fieldTag && <FieldTag tag={sec.fieldTag} />}
                  {/* 词性标签 */}
                  {sec.posLabel && (
                    <PosBadge label={sec.posLabel} color={sec.posColor} bg={sec.posBg} />
                  )}
                  {/* 释义文本 */}
                  <Text style={styles.translationText}>
                    {sec.meanings.join('；')}
                  </Text>
                </View>
              ))}
            </View>
          ) : translation ? (
            <Text style={styles.translationText}>{translation}</Text>
          ) : null}

          {/* 英文释义 - 清洗换行 + 1.5 倍行高 */}
          {parsedDefinition.length > 0 ? (
            <View style={styles.definitionBox}>
              <Text style={styles.definitionLabel}>英文释义</Text>
              {parsedDefinition.map((line, idx) => (
                <Text key={idx} style={styles.definitionText}>
                  {line}
                </Text>
              ))}
            </View>
          ) : definition ? (
            <View style={styles.definitionBox}>
              <Text style={styles.definitionLabel}>英文释义</Text>
              <Text style={styles.definitionText}>{definition}</Text>
            </View>
          ) : null}
        </View>

        {/* 分隔 */}
        <View style={styles.divider} />

        {/* 例句区 - 生词本来源展示数据库中的例句 */}
        {phrases.length > 0 && (
          <View style={styles.examplesSection}>
            <Text style={styles.sectionTitle}>例句</Text>
            {phrases.map((p, idx) => (
              <View key={idx} style={styles.exampleCard}>
                <View style={styles.exampleHeader}>
                  <View style={styles.exampleNum}>
                    <Text style={styles.exampleNumText}>{idx + 1}</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.exampleSpeakBtn}
                    onPress={() => handleSpeak(p.e)}
                  >
                    <Feather name="volume-2" size={16} color={ANCHOR} />
                  </TouchableOpacity>
                </View>
                <DashedWords text={p.e} style={styles.exampleEn} />
                <DashedWords text={p.c} style={styles.exampleCn} />
              </View>
            ))}
          </View>
        )}

        {/* 无例句时，完全隐藏例句板块（不显示占位提示） */}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a1a' },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 60 },

  // Top
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 8,
  },
  topBarLeft: { width: 40, alignItems: 'flex-start' },
  topBarRight: { width: 40, alignItems: 'flex-end' },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  topBarTitle: { fontSize: 18, fontWeight: '700', color: '#fff' },
  favBtn: {
    width: 40, height: 40,
    alignItems: 'center', justifyContent: 'center',
  },

  // Toast
  toastContainer: {
    position: 'absolute', top: 0, left: 0, right: 0,
    alignItems: 'center', zIndex: 100,
  },
  toastBox: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.85)',
    borderRadius: 20, paddingHorizontal: 20, paddingVertical: 10,
    gap: 8,
  },
  toastText: { fontSize: 15, fontWeight: '600', color: '#fff' },

  // Core
  coreSection: { paddingHorizontal: 20, paddingTop: 24 },
  // 单词行（单词 + 发音按钮水平排列）
  wordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  wordText: {
    fontSize: 36, fontWeight: '800', color: '#fff',
    letterSpacing: 1,
  },
  speakInlineBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: ANCHOR,
    alignItems: 'center',
    justifyContent: 'center',
  },
  phoneticText: {
    fontSize: 16, color: '#999', marginBottom: 20,
    fontFamily: 'monospace',
  },
  // 中文释义 - 按词性分段
  translationSection: {
    marginBottom: 20,
  },
  translationRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginBottom: 10,
    gap: 8,
  },
  translationText: {
    fontSize: 20, fontWeight: '600', color: ANCHOR,
    flexShrink: 1,
  },
  definitionBox: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12, padding: 14, marginBottom: 16,
  },
  definitionLabel: {
    fontSize: 12, fontWeight: '700', color: '#999',
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6,
  },
  definitionText: {
    fontSize: 15, color: 'rgba(255,255,255,0.8)', lineHeight: 23,
    marginBottom: 4,
  },
  // 词性标签 Badge
  posBadge: {
    alignSelf: 'flex-start',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
  },
  posBadgeText: {
    fontSize: 20,
    fontWeight: '700',
  },
  // 领域标签
  fieldTag: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  fieldTagText: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.6)',
  },
  // Divider
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.1)', marginHorizontal: 24, marginVertical: 24 },

  // Examples section
  examplesSection: { paddingHorizontal: 24, marginBottom: 20 },
  sectionTitle: {
    fontSize: 18, fontWeight: '700', color: '#fff', marginBottom: 16,
  },
  exampleCard: {
    backgroundColor: '#262626', borderRadius: 14,
    padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  exampleHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 10,
  },
  exampleNum: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: ANCHOR,
    alignItems: 'center', justifyContent: 'center',
  },
  exampleNumText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  exampleSpeakBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  exampleEn: { fontSize: 18, fontWeight: '600', color: '#FFFFFF', lineHeight: 26, paddingBottom: 8, textAlign: 'center' },
  exampleCn: { fontSize: 15, color: '#BBBBBB', lineHeight: 22, paddingTop: 8, textAlign: 'center' },
  noExampleHint: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 10, padding: 14, gap: 8,
  },
  noExampleText: { fontSize: 14, color: 'rgba(255,255,255,0.5)', flexShrink: 1 },
});
