/**
 * 实时目标检测服务（Bypass 模式）
 *
 * ⚠️ 注意：TensorFlow.js / COCO-SSD 当前已被暂时禁用。
 * 原因是 expo + React Native Hermes 环境下，
 * TensorFlow 的 fetch polyfill 存在兼容问题（Cannot read property 'fetch' of undefined）。
 *
 * 当前实现：
 * - loadModel() 立即将 isModelLoaded 设为 true，不加载任何模型
 * - detectFrame() 始终返回空数组
 * - dispose() 无操作
 *
 * ✅ 拍照识别 + 智谱 AI 云端分析不受影响，可以正常运行。
 * ✅ 所有依赖此服务的代码（camera.tsx）正常工作。
 * ✅ 无 TensorFlow 运行时错误。
 *
 * TODO: 如需启用本地实时检测，请：
 * 1. 安装 expo-standard-web-crypto 作为 fetch polyfill
 * 2. 取消 import * as cocoSsd / import * as tf 的注释
 * 3. 将本文件替换为原始实现
 */
import { Platform } from 'react-native';

// 检测结果类型
export interface DetectionBox {
  bbox: [number, number, number, number];
  score: number;
  label: string;
}

/**
 * 实时检测引擎（Bypass 版本）
 * 不加载任何模型，detectFrame 始终返回空
 */
export class RealtimeDetector {
  private isModelLoaded = false;
  private loadAttempted = false;
  /** 离线状态标记：true 表示处于离线模式，模型不可用 */
  public isOffline = false;

  /**
   * 立即完成 — 不加载 TensorFlow / COCO-SSD
   */
  async loadModel(): Promise<void> {
    if (this.isModelLoaded) return;
    if (this.loadAttempted) {
      console.log('⏳ 模型加载正在进行中...');
      return;
    }
    this.loadAttempted = true;

    // ★ Bypass: 跳过 TensorFlow 初始化，直接标记为已加载
    console.log('🔄 [Bypass] 跳过 TensorFlow.js 后端初始化');
    console.log(`   📱 平台: ${Platform.OS}, Hermes: ${(global as any).HermesInternal ? '是' : '否'}`);
    console.log('✅ [Bypass] 模型加载完成（空模型 — 仅用于兼容性）');
    this.isModelLoaded = true;
  }

  /**
   * 获取模型是否已加载
   */
  get loaded(): boolean {
    return this.isModelLoaded;
  }

  /**
   * 始终返回空数组（无实时检测）
   */
  async detectFrame(
    _pixels: Uint8Array,
    _imageWidth: number,
    _imageHeight: number
  ): Promise<{
    detections: DetectionBox[];
    timestamp: number;
    imageWidth: number;
    imageHeight: number;
  }> {
    if (!this.isModelLoaded) {
      return { detections: [], timestamp: Date.now(), imageWidth: _imageWidth, imageHeight: _imageHeight };
    }

    // ★ Bypass: 不执行任何检测
    return { detections: [], timestamp: Date.now(), imageWidth: _imageWidth, imageHeight: _imageHeight };
  }

  /**
   * 将检测框坐标转换为百分比坐标（相对于图片尺寸）
   * 纯数学函数，不依赖 TensorFlow
   */
  static boxesToPercentages(
    detections: DetectionBox[],
    imageWidth: number,
    imageHeight: number
  ): Array<{
    l: string;
    t: string;
    x: number;
    y: number;
    size: 'L' | 'S';
    bbox: [number, number, number, number];
  }> {
    return detections.map((det) => {
      const [x, y, w, h] = det.bbox;
      const centerX = ((x + w / 2) / imageWidth) * 100;
      const centerY = ((y + h / 2) / imageHeight) * 100;
      const area = (w * h) / (imageWidth * imageHeight);
      const size = area > 0.08 ? 'L' : 'S';

      return {
        l: det.label,
        t: det.label,
        x: Math.round(centerX * 10) / 10,
        y: Math.round(centerY * 10) / 10,
        size,
        bbox: det.bbox,
      };
    });
  }

  /**
   * 无操作
   */
  dispose(): void {
    this.isModelLoaded = false;
    console.log('[Bypass] 模型已释放（无操作）');
  }
}

// 单例导出
export const detector = new RealtimeDetector();
