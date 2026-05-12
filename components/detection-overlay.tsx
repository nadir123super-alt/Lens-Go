/**
 * DetectionOverlay - 实时目标检测点的覆盖层
 *
 * 在相机预览上方渲染珊瑚红 (#FF6B6B) 呼吸闪烁圆点
 * 每个点代表本地模型检测到的物体
 *
 * 交互状态：
 * - 默认（未选中）：红色呼吸灯（opacity 0.3 ↔ 1.0）
 * - 选中（等待分析）：黄色扫描光圈 + "Analyzing..." 标签
 * - 选中（已分析）：固定高亮
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleProp, StyleSheet, Text, TouchableOpacity, View, ViewStyle } from 'react-native';

const ANCHOR_COLOR = '#FF6B6B';
const YELLOW_LEARN = '#FFD93D';
const SCAN_RING_COLOR = 'rgba(255, 217, 61, 0.6)';

export interface DetectionPoint {
  id: string;
  l: string;
  t: string;
  x: number;
  y: number;
  size: 'L' | 'S';
  score: number;
  bbox?: [number, number, number, number];
}

interface Props {
  detections: DetectionPoint[];
  selectedId: string | null;
  scanningId: string | null;
  onPress: (point: DetectionPoint) => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * 单个检测点组件 — 支持点击、呼吸、扫描三种状态
 */
function DetectionDot({
  point,
  isSelected,
  isScanning,
  onPress,
}: {
  point: DetectionPoint;
  isSelected: boolean;
  isScanning: boolean;
  onPress: () => void;
}) {
  const dotSize = point.size === 'S' ? 10 : 18;
  const opacityAnim = useRef(new Animated.Value(0.3)).current;
  const scanRotateAnim = useRef(new Animated.Value(0)).current;
  const scanScaleAnim = useRef(new Animated.Value(1)).current;
  const breathRef = useRef<Animated.CompositeAnimation | null>(null);
  const scanRef = useRef<Animated.CompositeAnimation | null>(null);

  // === 呼吸动画（默认状态） ===
  useEffect(() => {
    if (isSelected) {
      // 选中：停止呼吸，固定 opacity=1
      if (breathRef.current) {
        breathRef.current.stop();
        breathRef.current = null;
      }
      opacityAnim.setValue(1);
    } else {
      // 未选中：呼吸闪烁
      opacityAnim.setValue(0.3);
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(opacityAnim, {
            toValue: 1.0,
            duration: 750,
            useNativeDriver: true,
          }),
          Animated.timing(opacityAnim, {
            toValue: 0.3,
            duration: 750,
            useNativeDriver: true,
          }),
        ])
      );
      loop.start();
      breathRef.current = loop;
    }
    return () => {
      if (breathRef.current) breathRef.current.stop();
    };
  }, [isSelected, opacityAnim]);

  // === 扫描动画（选中 + 正在分析） ===
  useEffect(() => {
    if (isScanning) {
      // 旋转光环
      scanRotateAnim.setValue(0);
      const rotateLoop = Animated.loop(
        Animated.timing(scanRotateAnim, {
          toValue: 1,
          duration: 1200,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      );
      rotateLoop.start();

      // 脉冲缩放
      scanScaleAnim.setValue(1);
      const scaleLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(scanScaleAnim, {
            toValue: 1.8,
            duration: 600,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(scanScaleAnim, {
            toValue: 1,
            duration: 600,
            easing: Easing.in(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      );
      scaleLoop.start();

      scanRef.current = Animated.parallel([rotateLoop, scaleLoop]);
    } else {
      if (scanRef.current) {
        scanRef.current.stop();
        scanRef.current = null;
      }
    }
    return () => {
      if (scanRef.current) scanRef.current.stop();
    };
  }, [isScanning, scanRotateAnim, scanScaleAnim]);

  const showTooltipAbove = point.y > 15;

  // 扫描旋转角度
  const scanRotation = scanRotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  // 主点样式：未选中 → 红色呼吸；选中（分析中）→ 黄色固定
  const dotBgColor = isSelected ? YELLOW_LEARN : ANCHOR_COLOR;
  const dotBorderStyle = isSelected ? styles.dotSelectedBorder : styles.dotDefaultBorder;
  const dotShadowStyle = isSelected ? styles.dotSelectedShadow : styles.dotDefaultShadow;

  return (
    <View
      style={[
        styles.dotWrapper,
        {
          left: `${point.x}%`,
          top: `${point.y}%`,
          width: dotSize,
          height: dotSize,
          transform: [{ translateX: -dotSize / 2 }, { translateY: -dotSize / 2 }],
        },
      ]}
    >
      <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
        {/* 扫描光环（仅在扫描时显示） */}
        {isScanning && (
          <Animated.View
            style={[
              styles.scanRing,
              {
                width: dotSize * 3,
                height: dotSize * 3,
                borderRadius: dotSize * 1.5,
                transform: [
                  { rotate: scanRotation },
                  { scale: scanScaleAnim },
                ],
              },
            ]}
          />
        )}

        {/* 主点 */}
        <View
          style={[
            styles.dot,
            {
              width: dotSize,
              height: dotSize,
              borderRadius: dotSize / 2,
              backgroundColor: dotBgColor,
            },
            dotBorderStyle,
            dotShadowStyle,
          ]}
        >
          {/* 呼吸透明度层 */}
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor: ANCHOR_COLOR,
                borderRadius: dotSize / 2,
                opacity: isSelected ? 0 : opacityAnim,
              },
            ]}
          />
        </View>
      </TouchableOpacity>

      {/* 标签：选中时显示 */}
      {isSelected && (
        <View
          style={[
            styles.tooltip,
            showTooltipAbove ? { bottom: dotSize / 2 + 12 } : { top: dotSize / 2 + 12 },
          ]}
          pointerEvents="none"
        >
          <Text style={styles.tooltipText} numberOfLines={1}>
            {isScanning ? 'Analyzing...' : point.l}
          </Text>
          {isScanning && (
            <Animated.View
              style={[styles.scanDotIndicator, { transform: [{ rotate: scanRotation }] }]}
            />
          )}
          <View
            style={[
              styles.tooltipArrow,
              showTooltipAbove ? styles.tooltipArrowDown : styles.tooltipArrowUp,
              { borderBottomColor: isScanning ? YELLOW_LEARN : 'rgba(0,0,0,0.85)',
                borderTopColor: isScanning ? YELLOW_LEARN : 'rgba(0,0,0,0.85)' },
            ]}
          />
        </View>
      )}
    </View>
  );
}

/**
 * 检测点覆盖层
 */
export function DetectionOverlay({ detections, selectedId, scanningId, onPress, style }: Props) {
  return (
    <View style={[styles.overlay, style]} pointerEvents="box-none">
      {detections.map((point) => (
        <DetectionDot
          key={point.id}
          point={point}
          isSelected={selectedId === point.id}
          isScanning={scanningId === point.id}
          onPress={() => onPress(point)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
  },
  dotWrapper: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  dot: {
    position: 'relative',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotDefaultBorder: {
    borderWidth: 3,
    borderColor: 'rgba(255, 107, 107, 0.5)',
  },
  dotSelectedBorder: {
    borderWidth: 3,
    borderColor: 'rgba(255, 217, 61, 0.7)',
  },
  dotDefaultShadow: {
    shadowColor: ANCHOR_COLOR,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 10,
    elevation: 10,
  },
  dotSelectedShadow: {
    shadowColor: YELLOW_LEARN,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 14,
    elevation: 14,
  },
  // 扫描光环：旋转的黄色光圈
  scanRing: {
    position: 'absolute',
    borderWidth: 3,
    borderColor: SCAN_RING_COLOR,
    borderLeftColor: 'transparent',
    borderBottomColor: 'transparent',
    top: -dotSizeOffset(18),
    left: -dotSizeOffset(18),
    zIndex: 5,
  },
  scanDotIndicator: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: YELLOW_LEARN,
    borderTopColor: 'transparent',
    marginLeft: 6,
  },
  tooltip: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.85)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    flexWrap: 'nowrap',
    zIndex: 20,
    shadowColor: '#FF6B6B',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 8,
    elevation: 8,
  },
  tooltipText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    flexShrink: 1,
    marginRight: 4,
  },
  tooltipArrow: {
    position: 'absolute',
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    alignSelf: 'center',
  },
  tooltipArrowUp: {
    top: -6,
    borderBottomWidth: 6,
  },
  tooltipArrowDown: {
    bottom: -6,
    borderTopWidth: 6,
  },
});

/**
 * 辅助函数：在 StyleSheet 中无法使用动态值，用静态替代
 */
function dotSizeOffset(size: number): number {
  return -(size * 0.5);
}
