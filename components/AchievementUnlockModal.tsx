/**
 * AchievementUnlockModal — 成就解锁弹窗
 * 
 * 展示新解锁的勋章，带有灰色变彩色的动画效果
 */
import { Feather } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import {
  Animated,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { BadgeDefinition, getBadgeById } from '@/services/achievementService';

interface AchievementUnlockModalProps {
  isVisible: boolean;
  badgeId: string;
  onClose: () => void;
}

export default function AchievementUnlockModal({ isVisible, badgeId, onClose }: AchievementUnlockModalProps) {
  const [badge, setBadge] = useState<BadgeDefinition | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const scaleAnim = useState(new Animated.Value(0))[0];
  const opacityAnim = useState(new Animated.Value(0))[0];
  const iconColorAnim = useState(new Animated.Value(0))[0];

  useEffect(() => {
    if (isVisible) {
      const found = getBadgeById(badgeId);
      setBadge(found || null);
      setIsAnimating(true);
      
      // 重置动画
      scaleAnim.setValue(0);
      opacityAnim.setValue(0);
      iconColorAnim.setValue(0);

      // 启动动画序列
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start(() => {
        // 缩放动画
        Animated.spring(scaleAnim, {
          toValue: 1,
          friction: 8,
          tension: 100,
          useNativeDriver: true,
        }).start(() => {
          // 图标颜色变化动画
          Animated.timing(iconColorAnim, {
            toValue: 1,
            duration: 800,
            useNativeDriver: false,
          }).start();
        });
      });
    } else {
      setIsAnimating(false);
    }
  }, [isVisible, badgeId]);

  if (!badge) return null;

  // 根据动画进度计算图标颜色（灰色 -> 彩色）
  const getIconStyle = () => {
    const color = iconColorAnim.interpolate({
      inputRange: [0, 1],
      outputRange: ['#666666', badge.color],
    });
    return { color };
  };

  return (
    <Modal
      visible={isVisible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={s.overlay} onPress={onClose}>
        <Animated.View
          style={[
            s.modalContent,
            {
              opacity: opacityAnim,
              transform: [{ scale: scaleAnim }],
            },
          ]}
        >
          {/* 勋章图标 */}
          <View style={s.iconContainer}>
            <Animated.View
              style={[s.iconWrapper, { transform: [{ scale: scaleAnim }] }]}
            >
              <Feather
                name={badge.icon as any}
                size={72}
                style={getIconStyle()}
              />
            </Animated.View>
            
            {/* 光芒效果 */}
            <Animated.View
              style={[
                s.glow,
                {
                  opacity: iconColorAnim.interpolate({
                    inputRange: [0, 0.5, 1],
                    outputRange: [0, 0.8, 0],
                  }),
                  transform: [
                    {
                      scale: iconColorAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.8, 1.5],
                      }),
                    },
                  ],
                },
              ]}
            />
          </View>

          {/* 标题 */}
          <Animated.Text
            style={[
              s.title,
              {
                opacity: iconColorAnim,
                transform: [
                  {
                    translateY: iconColorAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [20, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            🎉 解锁成就
          </Animated.Text>

          {/* 勋章名称 */}
          <Animated.Text
            style={[
              s.badgeName,
              {
                color: badge.color,
                opacity: iconColorAnim,
                transform: [
                  {
                    translateY: iconColorAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [15, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            {badge.name}
          </Animated.Text>

          {/* 描述 */}
          <Animated.Text
            style={[
              s.description,
              {
                opacity: iconColorAnim,
                transform: [
                  {
                    translateY: iconColorAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [10, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            {badge.description}
          </Animated.Text>

          {/* 确认按钮 */}
          <Animated.View
            style={{
              opacity: iconColorAnim,
            }}
          >
            <TouchableOpacity
              style={[s.closeBtn, { backgroundColor: badge.color }]}
              onPress={onClose}
              activeOpacity={0.7}
            >
              <Text style={s.closeBtnText}>太棒了！</Text>
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  modalContent: {
    backgroundColor: '#1E1E1E',
    borderRadius: 24,
    padding: 40,
    alignItems: 'center',
    width: '100%',
    maxWidth: 340,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
  },
  iconContainer: {
    position: 'relative',
    marginBottom: 24,
  },
  iconWrapper: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#2A2A2A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    top: -20,
    left: -20,
    right: -20,
    bottom: -20,
    borderRadius: 70,
    borderWidth: 3,
    borderColor: '#FF6B6B',
  },
  title: {
    fontSize: 18,
    color: '#FFFFFF',
    marginBottom: 12,
    fontWeight: '600',
  },
  badgeName: {
    fontSize: 32,
    fontWeight: '700',
    marginBottom: 16,
  },
  description: {
    fontSize: 15,
    color: '#999',
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 22,
  },
  closeBtn: {
    paddingVertical: 14,
    paddingHorizontal: 48,
    borderRadius: 12,
    alignItems: 'center',
  },
  closeBtnText: {
    fontSize: 17,
    color: '#FFFFFF',
    fontWeight: '600',
  },
});
