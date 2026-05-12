/**
 * SettingsScreen — 语音偏好设置 & 每日学习提醒
 *
 * 功能：
 * 1. 语速调节：Slider 滑动条 (0.5x ~ 2.0x)，步长 0.1
 * 2. 每日提醒：Switch 开关 + TimePicker 时间选择
 * 3. 根据路由参数 type 动态显示内容
 * 4. 数据持久化：AsyncStorage 存储
 * 5. 权限处理：通知权限 + 日历权限
 */
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
    Alert,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TouchableOpacity,
    View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
    disableReminder,
    enableReminder,
    loadReminderSettings,
    openAppSettings
} from '@/services/reminderService';
import {
    loadSpeechRate,
    MAX_SPEECH_RATE,
    MIN_SPEECH_RATE,
    saveSpeechRate,
    SPEECH_RATE_STEP,
} from '@/services/speechSettingsService';

const ANCHOR_COLOR = '#FF6B6B';

// ====== 时间选择器组件（简化版，使用 + / - 按钮）======

function TimePicker({
  label,
  hour,
  minute,
  onHourChange,
  onMinuteChange,
}: {
  label: string;
  hour: number;
  minute: number;
  onHourChange: (h: number) => void;
  onMinuteChange: (m: number) => void;
}) {
  const formatTime = (h: number, m: number) => {
    const period = h >= 12 ? '下午' : '上午';
    const h12 = h % 12 || 12;
    return `${period} ${h12}:${m.toString().padStart(2, '0')}`;
  };

  return (
    <View style={timeStyles.container}>
      <Text style={timeStyles.label}>{label}</Text>
      <View style={timeStyles.pickerRow}>
        {/* 小时 */}
        <View style={timeStyles.column}>
          <TouchableOpacity
            style={timeStyles.arrowBtn}
            onPress={() => onHourChange((hour + 1) % 24)}
            activeOpacity={0.6}
          >
            <Feather name="chevron-up" size={20} color="#FF6B6B" />
          </TouchableOpacity>
          <Text style={timeStyles.value}>{hour.toString().padStart(2, '0')}</Text>
          <TouchableOpacity
            style={timeStyles.arrowBtn}
            onPress={() => onHourChange((hour + 23) % 24)}
            activeOpacity={0.6}
          >
            <Feather name="chevron-down" size={20} color="#FF6B6B" />
          </TouchableOpacity>
        </View>

        <Text style={timeStyles.colon}>:</Text>

        {/* 分钟 */}
        <View style={timeStyles.column}>
          <TouchableOpacity
            style={timeStyles.arrowBtn}
            onPress={() => onMinuteChange((minute + 5) % 60)}
            activeOpacity={0.6}
          >
            <Feather name="chevron-up" size={20} color="#FF6B6B" />
          </TouchableOpacity>
          <Text style={timeStyles.value}>{minute.toString().padStart(2, '0')}</Text>
          <TouchableOpacity
            style={timeStyles.arrowBtn}
            onPress={() => onMinuteChange((minute + 55) % 60)}
            activeOpacity={0.6}
          >
            <Feather name="chevron-down" size={20} color="#FF6B6B" />
          </TouchableOpacity>
        </View>
      </View>
      <Text style={timeStyles.display}>{formatTime(hour, minute)}</Text>
    </View>
  );
}

const timeStyles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: '#2A2A2A',
    borderRadius: 16,
    padding: 16,
    flex: 1,
  },
  label: {
    fontSize: 13,
    color: '#AAAAAA',
    marginBottom: 8,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  column: {
    alignItems: 'center',
  },
  arrowBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#3D3D3D',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  value: {
    fontSize: 28,
    fontWeight: '700',
    color: '#FFFFFF',
    marginVertical: 4,
    fontVariant: ['tabular-nums'],
  },
  colon: {
    fontSize: 28,
    fontWeight: '700',
    color: '#FFFFFF',
    marginHorizontal: 8,
    marginTop: -4,
  },
  display: {
    fontSize: 14,
    color: '#FF6B6B',
    fontWeight: '600',
    marginTop: 8,
  },
});

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
    backgroundColor: '#2A2A2A',
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

  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [reminderHour, setReminderHour] = useState(20);
  const [reminderMinute, setReminderMinute] = useState(0);
  const [reminderLoaded, setReminderLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const rate = await loadSpeechRate();
      setSpeechRate(rate);
      setSpeechRateLoaded(true);

      const reminderSettings = await loadReminderSettings();
      setReminderEnabled(reminderSettings.enabled);
      setReminderHour(reminderSettings.hour);
      setReminderMinute(reminderSettings.minute);
      setReminderLoaded(true);
    })();
  }, []);

  const handleSpeechRateChange = useCallback(async (newRate: number) => {
    setSpeechRate(newRate);
    await saveSpeechRate(newRate);
  }, []);

  const handleReminderToggle = useCallback(
    async (enabled: boolean) => {
      if (enabled) {
        const result = await enableReminder(reminderHour, reminderMinute);
        
        if (result.needSettings) {
          Alert.alert(
            '通知权限已关闭',
            '系统通知权限已被拒绝，当前仅使用日历提醒。如需完整功能，请在系统设置中开启通知权限。',
            [
              { text: '我知道了', style: 'cancel' },
              { text: '去设置', onPress: openAppSettings }
            ]
          );
        }
        
        setReminderEnabled(true);
        console.log('[Settings] 每日提醒已开启');
      } else {
        await disableReminder();
        setReminderEnabled(false);
        console.log('[Settings] 每日提醒已关闭');
      }
    },
    [reminderHour, reminderMinute]
  );

  const handleHourChange = useCallback(
    async (h: number) => {
      setReminderHour(h);
      if (reminderEnabled) {
        await enableReminder(h, reminderMinute);
      }
    },
    [reminderEnabled, reminderMinute]
  );

  const handleMinuteChange = useCallback(
    async (m: number) => {
      setReminderMinute(m);
      if (reminderEnabled) {
        await enableReminder(reminderHour, m);
      }
    },
    [reminderEnabled, reminderHour]
  );

  const getPageConfig = () => {
    if (pageType === 'voice') {
      return { title: '语音偏好', icon: 'volume-2' };
    } else {
      return { title: '学习提醒', icon: 'bell' };
    }
  };

  const pageConfig = getPageConfig();

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Feather name="arrow-left" size={22} color="#FFFFFF" />
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

        {(pageType === 'reminder') && (
          <View style={s.section}>
            <View style={s.sectionHeader}>
              <Feather name="bell" size={18} color="#FF6B6B" />
              <Text style={s.sectionTitle}>每日学习提醒</Text>
            </View>

            <View style={s.card}>
              <View style={s.switchRow}>
                <View style={s.switchLabel}>
                  <Feather
                    name={reminderEnabled ? 'bell' : 'bell-off'}
                    size={18}
                    color={reminderEnabled ? '#FF6B6B' : '#999'}
                  />
                  <Text style={s.switchText}>
                    {reminderEnabled ? '已开启' : '已关闭'}
                  </Text>
                </View>
                {reminderLoaded && (
                  <Switch
                    value={reminderEnabled}
                    onValueChange={handleReminderToggle}
                    trackColor={{ false: '#E0E0E0', true: '#FF6B6B80' }}
                    thumbColor={reminderEnabled ? '#FF6B6B' : '#FFF'}
                    ios_backgroundColor="#E0E0E0"
                  />
                )}
              </View>

              {reminderEnabled && reminderLoaded && (
                <View style={s.timePickerRow}>
                  <TimePicker
                    label="提醒时间"
                    hour={reminderHour}
                    minute={reminderMinute}
                    onHourChange={handleHourChange}
                    onMinuteChange={handleMinuteChange}
                  />
                </View>
              )}

              <View style={s.infoRow}>
                <Feather name="info" size={14} color="#999" />
                <Text style={s.infoText}>
                  开启后，每天将在设定时间通过系统通知和日历日程双重提醒你学习
                </Text>
              </View>
            </View>

            <View style={s.tipsCard}>
              <View style={s.tipsHeader}>
                <Feather name="info" size={16} color="#FFB800" />
                <Text style={s.tipsTitle}>温馨提示</Text>
              </View>
              <Text style={s.tipsText}>
                • 系统通知需要在「设置 > 通知」中开启权限
              </Text>
              <Text style={s.tipsText}>
                • 日历提醒需要在「设置 > 日历」中开启权限
              </Text>
              <Text style={s.tipsText}>
                • 关闭提醒后，所有已预约的通知将被取消
              </Text>
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
    backgroundColor: '#121212',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#121212',
  },
  backBtn: {
    marginRight: 8,
    padding: 4,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
    marginLeft: 8,
  },
  scroll: {
    flex: 1,
    backgroundColor: '#121212',
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
    backgroundColor: '#1E1E1E',
    borderRadius: 18,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 3,
  },
  tipsCard: {
    backgroundColor: '#2A2A2A',
    borderRadius: 18,
    padding: 16,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#3D3D3D',
  },
  tipsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  tipsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFD93D',
    marginLeft: 6,
  },
  tipsText: {
    fontSize: 12,
    color: '#CCCCCC',
    lineHeight: 20,
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  switchLabel: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  switchText: {
    fontSize: 15,
    color: '#FFFFFF',
    marginLeft: 8,
    fontWeight: '500',
  },
  timePickerRow: {
    marginTop: 16,
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
