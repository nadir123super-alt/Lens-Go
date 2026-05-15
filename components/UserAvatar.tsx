/**
 * UserAvatar — 全局统一头像组件
 *
 * 使用 Robohash API 生成"猫与怪物"盲盒风格头像：
 *   - avatarType === 1 → 小猫（set=set4）
 *   - avatarType === 2 → 小怪物（set=set2）
 *
 * 背景色根据 userId 哈希从柔和色系中选取，实现"色彩适配"。
 *
 * 输入参数：
 *   userId     — 用户 ID，用于生成唯一头像和背景色
 *   avatarType — 1（猫）或 2（怪物）
 *   size       — 头像尺寸（宽高相同），默认 80
 */
import React from 'react';
import { Image, StyleSheet, View } from 'react-native';

interface UserAvatarProps {
  userId: string;
  avatarType: number;
  size?: number;
}

// ============================================================
// 柔和色系预设（浅色调，不抢 Robohash 形象戏份）
// ============================================================
const SOFT_COLORS = [
  '#E0F2FE', // 浅蓝色
  '#DCFCE7', // 浅绿色
  '#F3E8FF', // 浅紫色
  '#FEF9C3', // 浅黄色
  '#FEE2E2', // 浅红色
];

/**
 * 根据 userId 从柔和色系中选取一个颜色
 *
 * 算法：取 userId 首字符的 charCode，对色系数组长度取模，
 * 确保同一用户始终获得相同背景色。
 */
function getBackgroundColor(userId: string): string {
  const firstChar = userId.charAt(0);
  const code = firstChar.charCodeAt(0);
  const index = code % SOFT_COLORS.length;
  return SOFT_COLORS[index];
}

export default function UserAvatar({ userId, avatarType, size = 80 }: UserAvatarProps) {
  const set = avatarType === 1 ? 'set4' : 'set2';
  // 去掉 bgset 参数，获取透明背景的 PNG 图片
  const uri = `https://robohash.org/${userId}.png?set=${set}`;

  const borderRadius = size / 2;
  const backgroundColor = getBackgroundColor(userId);
  // 内边距：让形象居中且不顶边，看起来更精致
  const padding = Math.max(5, Math.round(size * 0.07));

  return (
    <View
      style={[
        styles.wrapper,
        {
          width: size,
          height: size,
          borderRadius,
          backgroundColor,
          padding,
        },
      ]}
    >
      <Image
        source={{ uri }}
        style={[
          styles.image,
          {
            width: size - padding * 2,
            height: size - padding * 2,
            borderRadius: (size - padding * 2) / 2,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    borderWidth: 1.5,
    borderColor: '#DDDDDD',
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    resizeMode: 'contain',
  },
});
