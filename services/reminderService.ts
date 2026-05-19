/**
 * ReminderService — 每日学习提醒服务
 *
 * 双重提醒机制：
 * 方案 A：本地通知 (expo-notifications) — 每天重复推送，文案随机化
 * 方案 B：日历日程 (expo-calendar) — 写入系统日历循环日程
 *
 * 数据持久化：
 * - reminder_enabled / reminder_hour / reminder_minute → Supabase user_settings 表
 * - calendar_event_id → AsyncStorage（本地日历系统集成，非用户数据）
 * - 离线降级：无网络时读写 AsyncStorage 缓存，联网后自动同步至 Supabase
 */
import { supabase } from '@/services/supabaseClient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isRunningInExpoGo } from 'expo';
import * as Calendar from 'expo-calendar';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

const STORAGE_KEY_REMINDER_ENABLED = '@lensgo/reminder_enabled';
const STORAGE_KEY_REMINDER_HOUR = '@lensgo/reminder_hour';
const STORAGE_KEY_REMINDER_MINUTE = '@lensgo/reminder_minute';
const STORAGE_KEY_CALENDAR_EVENT_ID = '@lensgo/calendar_event_id';

const REMINDER_TITLES = [
  '该来收集新单词了！',
  '你的口语勋章还没领取哦！',
  '今天也要加油学英语！',
  '打开 App，收获新知识',
  '每日一练，英语更流利',
  '别让今天的单词留到明天',
  '你的 AI 英语助手已上线',
  '学习打卡时间到！',
  '用镜头捕捉新单词吧',
  '口语练习时间到 🎤',
  '快来看看你的镜头能识别出什么新单词？',
  '今天的学习目标完成了吗？',
];

const REMINDER_BODIES = [
  '每天 10 分钟，英语进步看得见',
  '拍照识词 + 口语练习，轻松学英语',
  '新单词在镜头里等你发现',
  '坚持学习，解锁更多勋章成就',
  '你的专属 AI 英语伙伴提醒你学习',
  '积累每一天，成就更好的自己',
  '今日不学，明日不进',
];

let Notifications: typeof import('expo-notifications') | null = null;
let notificationsAvailable = true;

function isNotificationsAvailable(): boolean {
  if (isRunningInExpoGo() && Platform.OS === 'android') {
    console.warn('[Reminder] Expo Go Android 环境下，本地通知功能受限，仅使用日历提醒');
    return false;
  }
  return notificationsAvailable;
}

async function getNotificationsModule(): Promise<typeof import('expo-notifications') | null> {
  if (!isNotificationsAvailable()) {
    return null;
  }
  
  if (!Notifications) {
    try {
      Notifications = await import('expo-notifications');
    } catch (e) {
      console.warn('[Reminder] 加载 expo-notifications 模块失败:', e);
      notificationsAvailable = false;
      return null;
    }
  }
  return Notifications;
}

export async function configureNotifications(): Promise<void> {
  if (!isNotificationsAvailable()) {
    console.warn('[Reminder] 通知配置跳过（当前环境不支持）');
    return;
  }
  
  const notifications = await getNotificationsModule();
  if (!notifications) {
    return;
  }
  
  try {
    notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
  } catch (e) {
    console.warn('[Reminder] 配置通知处理器失败:', e);
  }
}

export async function requestNotificationPermission(): Promise<{ granted: boolean; canAskAgain: boolean; available: boolean }> {
  if (!isNotificationsAvailable()) {
    console.warn('[Reminder] 通知功能不可用（当前环境限制）');
    return { granted: false, canAskAgain: false, available: false };
  }
  
  const notifications = await getNotificationsModule();
  if (!notifications) {
    return { granted: false, canAskAgain: false, available: false };
  }
  
  try {
    const { status: existingStatus, canAskAgain } = await notifications.getPermissionsAsync();
    
    if (existingStatus === 'granted') {
      return { granted: true, canAskAgain: true, available: true };
    }
    
    if (existingStatus === 'denied' && !canAskAgain) {
      return { granted: false, canAskAgain: false, available: true };
    }
    
    const { status, canAskAgain: newCanAskAgain } = await notifications.requestPermissionsAsync();
    
    return { 
      granted: status === 'granted', 
      canAskAgain: newCanAskAgain,
      available: true
    };
  } catch (e) {
    console.warn('[Reminder] 请求通知权限失败:', e);
    return { granted: false, canAskAgain: false, available: true };
  }
}

export async function openAppSettings(): Promise<void> {
  try {
    await Linking.openSettings();
  } catch (e) {
    console.warn('[Reminder] 打开系统设置失败:', e);
  }
}

export async function requestCalendarPermission(): Promise<boolean> {
  try {
    const { status: existingStatus } = await Calendar.requestCalendarPermissionsAsync();
    if (existingStatus !== 'granted') {
      console.warn('[Reminder] 日历权限未授予');
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[Reminder] 请求日历权限失败:', e);
    return false;
  }
}

function getRandomTitle(): string {
  return REMINDER_TITLES[Math.floor(Math.random() * REMINDER_TITLES.length)];
}

function getRandomBody(): string {
  return REMINDER_BODIES[Math.floor(Math.random() * REMINDER_BODIES.length)];
}

export async function cancelAllNotifications(): Promise<void> {
  if (!isNotificationsAvailable()) {
    return;
  }
  
  const notifications = await getNotificationsModule();
  if (!notifications) {
    return;
  }
  
  try {
    await notifications.cancelAllScheduledNotificationsAsync();
    console.log('[Reminder] 所有通知已取消');
  } catch (e) {
    console.warn('[Reminder] 取消通知失败:', e);
  }
}

export async function scheduleDailyNotification(hour: number, minute: number): Promise<boolean> {
  if (!isNotificationsAvailable()) {
    console.warn('[Reminder] 跳过日程通知（当前环境不支持）');
    return false;
  }
  
  const notifications = await getNotificationsModule();
  if (!notifications) {
    return false;
  }
  
  await cancelAllNotifications();
  
  try {
    await notifications.scheduleNotificationAsync({
      content: {
        title: getRandomTitle(),
        body: getRandomBody(),
        sound: true,
      },
      trigger: {
        type: notifications.SchedulableTriggerInputTypes.DAILY,
        hour,
        minute,
      },
    });
    
    console.log(`[Reminder] 每日通知已注册: ${hour}:${minute.toString().padStart(2, '0')}`);
    return true;
  } catch (e) {
    console.warn('[Reminder] 注册每日通知失败:', e);
    return false;
  }
}

export async function setupCalendarEvent(hour: number, minute: number): Promise<void> {
  const hasPermission = await requestCalendarPermission();
  if (!hasPermission) return;

  let defaultCalendarSource: Calendar.Source;
  try {
    if (Platform.OS === 'ios') {
      defaultCalendarSource = await getDefaultCalendarSource();
    } else {
      const sources = await Calendar.getSourcesAsync();
      defaultCalendarSource = sources.find((s) => s.type === 'local') || sources[0];
    }
  } catch (e) {
    console.warn('[Reminder] 获取日历源失败:', e);
    return;
  }

  let calendar;
  try {
    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    calendar = calendars.find(
      (cal) =>
        cal.source.name === defaultCalendarSource.name &&
        cal.allowsModifications
    );
  } catch (e) {
    console.warn('[Reminder] 获取日历列表失败:', e);
    return;
  }

  if (!calendar) {
    try {
      const newCalendarId = await Calendar.createCalendarAsync({
        title: '英语学习',
        color: '#FF6B6B',
        entityType: Calendar.EntityTypes.EVENT,
        sourceId: defaultCalendarSource.id,
        source: defaultCalendarSource,
        name: 'lensgo-calendar',
        ownerAccount: 'personal',
        accessLevel: Calendar.CalendarAccessLevel.OWNER,
      });
      const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      calendar = calendars.find((cal) => cal.id === newCalendarId);
    } catch (e) {
      console.warn('[Reminder] 创建日历失败:', e);
      return;
    }
  }

  if (!calendar) {
    console.warn('[Reminder] 无法获取或创建日历');
    return;
  }

  const existingEventId = await AsyncStorage.getItem(STORAGE_KEY_CALENDAR_EVENT_ID);
  if (existingEventId) {
    try {
      await Calendar.deleteEventAsync(existingEventId);
    } catch {
    }
  }

  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0);

  try {
    const eventId = await Calendar.createEventAsync(calendar.id, {
      title: '📚 英语学习时间',
      notes: getRandomBody(),
      startDate,
      endDate: new Date(startDate.getTime() + 30 * 60 * 1000),
      recurrenceRule: {
        frequency: Calendar.Frequency.DAILY,
        interval: 1,
      },
      alarms: [{ relativeOffset: -5 }],
    });

    await AsyncStorage.setItem(STORAGE_KEY_CALENDAR_EVENT_ID, eventId);
    console.log(`[Reminder] 日历日程已创建: ${hour}:${minute.toString().padStart(2, '0')}`);
  } catch (e) {
    console.warn('[Reminder] 创建日历事件失败:', e);
  }
}

export async function removeCalendarEvent(): Promise<void> {
  const existingEventId = await AsyncStorage.getItem(STORAGE_KEY_CALENDAR_EVENT_ID);
  if (existingEventId) {
    try {
      await Calendar.deleteEventAsync(existingEventId);
    } catch (e) {
      console.warn('[Reminder] 删除日历事件失败:', e);
    }
    await AsyncStorage.removeItem(STORAGE_KEY_CALENDAR_EVENT_ID);
  }
}

async function getDefaultCalendarSource(): Promise<Calendar.Source> {
  const defaultCalendar = await Calendar.getDefaultCalendarAsync();
  return defaultCalendar.source;
}

export interface ReminderSettings {
  enabled: boolean;
  hour: number;
  minute: number;
}

/**
 * 获取当前登录用户 ID
 */
async function getCurrentUserId(): Promise<string | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id || null;
  } catch {
    return null;
  }
}

/**
 * 从 Supabase 加载提醒设置，降级到 AsyncStorage
 */
export async function loadReminderSettings(): Promise<ReminderSettings> {
  // 先尝试从 Supabase 加载
  const userId = await getCurrentUserId();
  if (userId) {
    try {
      const { data, error } = await supabase
        .from('user_settings')
        .select('reminder_enabled, reminder_hour, reminder_minute')
        .eq('user_id', userId)
        .maybeSingle();

      if (!error && data) {
        const settings: ReminderSettings = {
          enabled: data.reminder_enabled ?? false,
          hour: data.reminder_hour ?? 20,
          minute: data.reminder_minute ?? 0,
        };
        // 同步到 AsyncStorage 作为离线缓存
        await AsyncStorage.setItem(STORAGE_KEY_REMINDER_ENABLED, String(settings.enabled));
        await AsyncStorage.setItem(STORAGE_KEY_REMINDER_HOUR, String(settings.hour));
        await AsyncStorage.setItem(STORAGE_KEY_REMINDER_MINUTE, String(settings.minute));
        return settings;
      }
    } catch (e) {
      console.warn('[Reminder] Supabase 读取设置失败，降级到 AsyncStorage:', e);
    }
  }

  // 降级：从 AsyncStorage 读取
  try {
    const enabledStr = await AsyncStorage.getItem(STORAGE_KEY_REMINDER_ENABLED);
    const hourStr = await AsyncStorage.getItem(STORAGE_KEY_REMINDER_HOUR);
    const minuteStr = await AsyncStorage.getItem(STORAGE_KEY_REMINDER_MINUTE);

    return {
      enabled: enabledStr === 'true',
      hour: hourStr ? parseInt(hourStr, 10) : 20,
      minute: minuteStr ? parseInt(minuteStr, 10) : 0,
    };
  } catch {
    return { enabled: false, hour: 20, minute: 0 };
  }
}

/**
 * 保存提醒设置到 Supabase 和 AsyncStorage（离线缓存）
 */
export async function saveReminderSettings(settings: ReminderSettings): Promise<void> {
  // 始终写入 AsyncStorage 作为离线缓存
  try {
    await AsyncStorage.setItem(STORAGE_KEY_REMINDER_ENABLED, String(settings.enabled));
    await AsyncStorage.setItem(STORAGE_KEY_REMINDER_HOUR, String(settings.hour));
    await AsyncStorage.setItem(STORAGE_KEY_REMINDER_MINUTE, String(settings.minute));
  } catch (e) {
    console.warn('[Reminder] AsyncStorage 保存设置失败:', e);
  }

  // 尝试同步到 Supabase
  const userId = await getCurrentUserId();
  if (userId) {
    try {
      const { error } = await supabase
        .from('user_settings')
        .upsert({
          user_id: userId,
          reminder_enabled: settings.enabled,
          reminder_hour: settings.hour,
          reminder_minute: settings.minute,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'user_id',
        });

      if (error) {
        console.warn('[Reminder] Supabase 保存设置失败，已降级到本地缓存:', error);
      }
    } catch (e) {
      console.warn('[Reminder] Supabase 保存设置异常，已降级到本地缓存:', e);
    }
  }
}

export async function enableReminder(hour: number, minute: number): Promise<{ success: boolean; needSettings: boolean; notificationUsed: boolean; method: 'notification' | 'calendar' | 'both' }> {
  const notificationResult = await requestNotificationPermission();
  
  if (!notificationResult.available) {
    // Expo Go Android 环境：仅使用日历提醒
    await setupCalendarEvent(hour, minute);
    await saveReminderSettings({ enabled: true, hour, minute });
    console.log('[Reminder] 提醒已启用（使用日历日程）');
    return { success: true, needSettings: false, notificationUsed: false, method: 'calendar' };
  }
  
  if (!notificationResult.granted && !notificationResult.canAskAgain) {
    // 用户拒绝通知权限且无法再次请求：使用日历提醒
    await setupCalendarEvent(hour, minute);
    await saveReminderSettings({ enabled: true, hour, minute });
    console.log('[Reminder] 提醒已启用（通知权限被拒绝，使用日历日程）');
    return { success: true, needSettings: true, notificationUsed: false, method: 'calendar' };
  }
  
  let notificationUsed = false;
  let method: 'notification' | 'calendar' | 'both' = 'calendar';
  
  if (notificationResult.granted) {
    notificationUsed = await scheduleDailyNotification(hour, minute);
    if (notificationUsed) {
      method = 'both';
    }
  }

  await setupCalendarEvent(hour, minute);

  await saveReminderSettings({ enabled: true, hour, minute });
  
  console.log(`[Reminder] 提醒已启用（${method === 'both' ? '通知 + 日历' : '仅日历'}）`);
  return { success: true, needSettings: false, notificationUsed, method };
}

export async function disableReminder(): Promise<void> {
  await cancelAllNotifications();
  await removeCalendarEvent();

  const settings = await loadReminderSettings();
  await saveReminderSettings({ ...settings, enabled: false });
}
