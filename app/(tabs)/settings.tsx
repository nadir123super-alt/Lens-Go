/**
 * SettingsScreen — 语音偏好设置
 *
 * 功能：
 * 1. 语速调节：Slider 滑动条 (0.5x ~ 2.0x)，步长 0.1
 * 2. 根据路由参数 type 动态显示内容
 * 3. 数据持久化：AsyncStorage 存储
 */
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  loadSpeechRate,
  MAX_SPEECH_RATE,
  MIN_SPEECH_RATE,
  saveSpeechRate,
  SPEECH_RATE_STEP,
} from '@/services/speechSettingsService';

const ANCHOR_COLOR = '#FF6B6B';

// ====== 自定义滑块组件 ======

function SpeechRateSlider({
  value,
  onValueChange,
}: {
  value: number;
  onValueChange: (v: number) => void;
}) {
  // 将 0.5~2.0 映射到 0~1
  const range = MAX_SPEECH_RATE - MIN_SPEECH_RATE;
  const ratio = (value - MIN_SPEECH_RATE) / range;
  const steps = Math.round(range / SPEECH_RATE_STEP);

  const handleDecrease = () => {
    const newVal = Math.max(MIN_SPEECH_RATE, value - SPEECH_RATE_STEP);
    onValueChange(Math.round(newVal * 10) / 10);
  };

  const handleIncrease = () => {
    const newVal = Math.min(MAX_SPEECH_RATE, value + SPEECH_RATE_STEP);
    onValueChange(Math.round(newVal * 10) / 10);
  };

  const handleBarPress = (evt: any) => {
    const { locationX } = evt.nativeEvent;
    const barWidth = 260;
    const newRatio = Math.max(0, Math.min(1, locationX / barWidth));
    const newVal = MIN_SPEECH_RATE + newRatio * range;
    const stepped = Math.round(newVal / SPEECH_RATE_STEP) * SPEECH_RATE_STEP;
    const finalValue = Math.round(stepped * 10) / 10;
    const clampedValue = Math.max(MIN_SPEECH_RATE, Math.min(MAX_SPEECH_RATE, finalValue));
    onValueChange(clampedValue);
  };

  return (
    <View style={sliderStyles.container}>
      <View style={sliderStyles.labelRow}>
        <Text style={sliderStyles.speedLabel}>语速</Text>
        <Text style={sliderStyles.speedValue}>{value.toFixed(1)}x</Text>
      </View>

      <View style={sliderStyles.barRow}>
        <TouchableOpacity onPress={handleDecrease} activeOpacity={0.6} style={sliderStyles.stepBtn}>
          <Feather name="minus-circle" size={22} color="#FF6B6B" />
        </TouchableOpacity>

        <TouchableOpacity
          style={sliderStyles.bar}
          onPress={handleBarPress}
          activeOpacity={0.9}
        >
          <View style={sliderStyles.track} />
          <View
            style={[
              sliderStyles.fill,
              { width: `${ratio * 100}%` },
            ]}
          />
          <View
            style={[
              sliderStyles.thumb,
              { left: `${ratio * 100}%` },
            ]}
          />
        </TouchableOpacity>

        <TouchableOpacity onPress={handleIncrease} activeOpacity={0.6} style={sliderStyles.stepBtn}>
          <Feather name="plus-circle" size={22} color="#FF6B6B" />
        </TouchableOpacity>
      </View>

      <View style={sliderStyles.scaleRow}>
        <Text style={sliderStyles.scaleLabel}>慢</Text>
        <View style={sliderStyles.scaleTicks}>
          {Array.from({ length: steps + 1 }, (_, i) => (
            <View
              key={i}
              style={[
                sliderStyles.tick,
                i === 0 || i === steps ? sliderStyles.tickMain : sliderStyles.tickMinor,
              ]}
            />
          ))}
        </View>
        <Text style={sliderStyles.scaleLabel}>快</Text>
      </View>
    </View>
  );
}

const sliderStyles = StyleSheet.create({
  container: {
    backgroundColor: '#2a2a2a',
    borderRadius: 16,
    padding: 20,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  speedLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  speedValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FF6B6B',
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepBtn: {
    padding: 4,
  },
  bar: {
    flex: 1,
    height: 40,
    justifyContent: 'center',
    position: 'relative',
    marginHorizontal: 8,
  },
  track: {
    height: 6,
    backgroundColor: '#3D3D3D',
    borderRadius: 3,
  },
  fill: {
    position: 'absolute',
    left: 0,
    height: 6,
    backgroundColor: '#FF6B6B',
    borderRadius: 3,
  },
  thumb: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 3,
    borderColor: '#FF6B6B',
    marginLeft: -12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  scaleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
  },
  scaleLabel: {
    fontSize: 11,
    color: '#AAAAAA',
    width: 20,
    textAlign: 'center',
  },
  scaleTicks: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginHorizontal: 8,
  },
  tick: {
    width: 2,
    borderRadius: 1,
  },
  tickMain: {
    height: 8,
    backgroundColor: '#666666',
  },
  tickMinor: {
    height: 4,
    backgroundColor: '#444444',
  },
});

// ====== 主页面 ======

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { type } = useLocalSearchParams<{ type: string }>();
  const pageType = type || 'voice';

  const [speechRate, setSpeechRate] = useState(1.0);
  const [speechRateLoaded, setSpeechRateLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const rate = await loadSpeechRate();
      setSpeechRate(rate);
      setSpeechRateLoaded(true);
    })();
  }, []);

  const handleSpeechRateChange = useCallback(async (newRate: number) => {
    setSpeechRate(newRate);
    await saveSpeechRate(newRate);
  }, []);

  const getPageConfig = (): { title: string; icon: keyof typeof Feather.glyphMap } => {
    return { title: '语音偏好', icon: 'volume-2' };
  };

  const pageConfig = getPageConfig();

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.7}>
          <Feather name="arrow-left" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Feather name={pageConfig.icon} size={22} color="#FF6B6B" />
        <Text style={s.headerTitle}>{pageConfig.title}</Text>
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {(pageType === 'voice') && (
          <View style={s.section}>
            <View style={s.sectionHeader}>
              <Feather name="volume-2" size={18} color="#FF6B6B" />
              <Text style={s.sectionTitle}>语音偏好设置</Text>
            </View>

            <View style={s.card}>
              {speechRateLoaded && (
                <SpeechRateSlider
                  value={speechRate}
                  onValueChange={handleSpeechRateChange}
                />
              )}

              <View style={s.infoRow}>
                <Feather name="info" size={14} color="#999" />
                <Text style={s.infoText}>
                  调节后，单词发音和口语评测的标准读音将立即生效，无需重启 App
                </Text>
              </View>
            </View>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

// ====== 样式 ======

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#1a1a1a',
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -15,
    marginRight: 8,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#FFFFFF',
    marginLeft: 8,
  },
  scroll: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginLeft: 8,
  },
  card: {
    backgroundColor: '#2a2a2a',
    borderRadius: 18,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 3,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#333333',
  },
  infoText: {
    fontSize: 12,
    color: '#999999',
    marginLeft: 6,
    flex: 1,
    lineHeight: 18,
  },
});
