/**
 * StarButton - 五角星收藏按钮
 *
 * 点击切换空心/实心，带缩放动画，自动执行收藏/取消收藏
 */
import { isWordFavorited, toggleFavorite } from '@/services/vocabularyService';
import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, TouchableOpacity } from 'react-native';

interface Props {
  word: string;
  translation: string;
  phrases: Array<{ e: string; c: string }>;
  source: 'camera' | 'search';
  usage?: string;
  imagePath?: string;
  size?: number;
  onToggle?: (isFavorited: boolean) => void;
}

export default function StarButton({
  word,
  translation,
  phrases,
  source,
  usage,
  imagePath,
  size = 26,
  onToggle,
}: Props) {
  const [isFav, setIsFav] = useState(false);
  const [checking, setChecking] = useState(true);
  const scaleAnim = useRef(new Animated.Value(1)).current;

  // 初始检查状态
  useEffect(() => {
    (async () => {
      try {
        const fav = await isWordFavorited(word);
        if (!checking) return;
        setIsFav(fav);
      } catch {} finally {
        setChecking(false);
      }
    })();
    return () => setChecking(false);
  }, [word]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePress = useCallback(async () => {
    // 缩放动画
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 0.6, duration: 100, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, friction: 3, tension: 200, useNativeDriver: true }),
    ]).start();

    try {
      const result = await toggleFavorite(word, translation, phrases, source, usage, imagePath);
      setIsFav(result.favorited);
      onToggle?.(result.favorited);
    } catch {}
  }, [word, translation, phrases, source, usage, imagePath, scaleAnim, onToggle]);

  if (checking) return null;

  return (
    <TouchableOpacity onPress={handlePress} activeOpacity={0.7} style={styles.container}>
      <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
        <Ionicons
          name={isFav ? 'star' : 'star-outline'}
          size={size}
          color={isFav ? '#FF6B6B' : '#ccc'}
        />
      </Animated.View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
