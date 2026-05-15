/**
 * 马卡龙色系主题配置
 * Macaron Color Theme for LensGo
 * 
 * 颜色映射规则：
 * - 红色 → 马卡龙粉红
 * - 绿色 → 马卡龙薄荷绿
 * - 橙色 → 马卡龙橙
 * - 蓝色 → 马卡龙蓝
 * - 紫色 → 马卡龙紫
 * - 黄色 → 马卡龙黄
 * - 粉色 → 马卡龙粉
 * - 青色 → 马卡龙青
 */

import { Platform } from 'react-native';

// ============================================================
// 马卡龙色板 (Macaron Color Palette)
// ============================================================

// 主要颜色 (Primary Colors)
export const MACARON = {
  // 红色系 → 马卡龙粉红
  RED: '#FFB3B3',
  RED_DARK: '#FF8A8A',
  RED_LIGHT: '#FFD4D4',
  
  // 绿色系 → 马卡龙薄荷绿
  GREEN: '#A8E6CF',
  GREEN_DARK: '#7DD3B0',
  GREEN_LIGHT: '#C8F4E3',
  
  // 橙色系 → 马卡龙橙
  ORANGE: '#FFD3A5',
  ORANGE_DARK: '#FFB87A',
  ORANGE_LIGHT: '#FFE8C8',
  
  // 蓝色系 → 马卡龙蓝
  BLUE: '#A8D8EA',
  BLUE_DARK: '#7FC4D8',
  BLUE_LIGHT: '#C8EAF5',
  
  // 紫色系 → 马卡龙紫
  PURPLE: '#C9B1FF',
  PURPLE_DARK: '#A888FF',
  PURPLE_LIGHT: '#E0D4FF',
  
  // 黄色系 → 马卡龙黄
  YELLOW: '#FFEAA7',
  YELLOW_DARK: '#FFD93D',
  YELLOW_LIGHT: '#FFF4C8',
  
  // 粉色系 → 马卡龙粉
  PINK: '#FFB6C1',
  PINK_DARK: '#FF8FA3',
  PINK_LIGHT: '#FFD6DC',
  
  // 青色系 → 马卡龙青
  CYAN: '#B8F0E8',
  CYAN_DARK: '#8AE5DA',
  CYAN_LIGHT: '#D8F8F3',
  
  // 珊瑚色系 → 马卡龙珊瑚
  CORAL: '#FFB8A8',
  CORAL_DARK: '#FF9580',
  CORAL_LIGHT: '#FFD4C8',
  
  // 灰色系 (保持中性)
  GRAY: '#9BA1A6',
  GRAY_DARK: '#687076',
  GRAY_LIGHT: '#C4C7CC',
};

// ============================================================
// 深色模式背景色
// ============================================================
export const DARK_BG = {
  PRIMARY: '#1E1E2E',    // 主要背景 - 深紫灰
  SECONDARY: '#2A2A3E',  // 次要背景
  TERTIARY: '#363650',   // 第三级背景
  CARD: '#252538',       // 卡片背景
  BORDER: '#3D3D5C',    // 边框色
};

// ============================================================
// 成就徽章颜色 (Macaron versions)
// ============================================================
export const ACHIEVEMENT_COLORS = {
  初识世界: MACARON.ORANGE,
  万物皆单词: MACARON.PURPLE,
  词汇学徒: MACARON.BLUE,
  词汇能手: MACARON.PURPLE,
  百词达人: MACARON.PINK,
  词汇大师: MACARON.CORAL,
  初试啼声: MACARON.GREEN,
  语出惊人: MACARON.CYAN,
  黄金舌头: MACARON.YELLOW,
  完美发音: MACARON.ORANGE,
  复读机: MACARON.GREEN,
  坚持不懈: MACARON.BLUE,
  学习达人: MACARON.PURPLE,
  快手扫描仪: MACARON.CYAN,
  捕光者: MACARON.YELLOW,
  翻译官的午后: MACARON.PINK,
  路边社社长: MACARON.CORAL,
  念念不忘: MACARON.PURPLE,
};

// ============================================================
// 评分反馈颜色
// ============================================================
export const SCORE_COLORS = {
  EXCELLENT: MACARON.GREEN,    // 85-100分 绿色
  GOOD: MACARON.ORANGE,        // 60-84分 橙色
  NEEDS_IMPROVEMENT: MACARON.RED, // 0-59分 红色
};

// ============================================================
// 词性颜色 (Macaron versions)
// ============================================================
export const PART_OF_SPEECH_COLORS = {
  'n':     { label: '名词',     color: MACARON.BLUE,   bg: `${MACARON.BLUE_LIGHT}26` },
  'v':     { label: '动词',     color: MACARON.PINK,   bg: `${MACARON.PINK_LIGHT}26` },
  'vi':    { label: '不及物动词', color: MACARON.PINK, bg: `${MACARON.PINK_LIGHT}26` },
  'vt':    { label: '及物动词', color: MACARON.PINK,   bg: `${MACARON.PINK_LIGHT}26` },
  'aux':   { label: '助动词',   color: MACARON.PINK,   bg: `${MACARON.PINK_LIGHT}26` },
  'a':     { label: '形容词',   color: MACARON.ORANGE, bg: `${MACARON.ORANGE_LIGHT}26` },
  'adj':   { label: '形容词',   color: MACARON.ORANGE, bg: `${MACARON.ORANGE_LIGHT}26` },
  'ad':    { label: '形容词',   color: MACARON.ORANGE, bg: `${MACARON.ORANGE_LIGHT}26` },
  'adv':   { label: '副词',     color: MACARON.PURPLE,  bg: `${MACARON.PURPLE_LIGHT}26` },
  'prep':  { label: '介词',     color: MACARON.CYAN,   bg: `${MACARON.CYAN_LIGHT}26` },
  'conj':  { label: '连词',     color: MACARON.CORAL,  bg: `${MACARON.CORAL_LIGHT}26` },
  'pron':  { label: '代词',     color: MACARON.CYAN,   bg: `${MACARON.CYAN_LIGHT}26` },
  'num':   { label: '数词',     color: MACARON.YELLOW, bg: `${MACARON.YELLOW_LIGHT}26` },
  'art':   { label: '冠词',     color: MACARON.GREEN,  bg: `${MACARON.GREEN_LIGHT}26` },
  'int':   { label: '感叹词',   color: MACARON.RED,    bg: `${MACARON.RED_LIGHT}26` },
  'det':   { label: '限定词',   color: MACARON.GREEN,  bg: `${MACARON.GREEN_LIGHT}26` },
  'modal': { label: '情态动词', color: MACARON.PINK,   bg: `${MACARON.PINK_LIGHT}26` },
};

// ============================================================
// 通用颜色导出 (兼容旧代码)
// ============================================================
export const ANCHOR_COLOR = MACARON.RED;
export const FAVORITE_YELLOW = MACARON.YELLOW;
export const ACTIVE_TAB_COLOR = MACARON.RED;
export const SUCCESS_COLOR = MACARON.GREEN;
export const WARNING_COLOR = MACARON.ORANGE;
export const ERROR_COLOR = MACARON.RED;

// ============================================================
// Theme Colors (Expo 标准格式)
// ============================================================
const tintColorLight = MACARON.BLUE;
const tintColorDark = MACARON.RED;

export const Colors = {
  light: {
    text: '#11181C',
    background: '#fff',
    tint: tintColorLight,
    icon: '#687076',
    tabIconDefault: '#687076',
    tabIconSelected: tintColorLight,
  },
  dark: {
    text: '#ECEDEE',
    background: DARK_BG.PRIMARY,
    tint: tintColorDark,
    icon: MACARON.GRAY,
    tabIconDefault: MACARON.GRAY,
    tabIconSelected: tintColorDark,
  },
};

// ============================================================
// Fonts
// ============================================================
export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
