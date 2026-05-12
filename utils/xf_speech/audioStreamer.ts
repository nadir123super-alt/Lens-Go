/**
 * AudioStreamer — 音频流处理器
 *
 * 功能：将 PCM/WAV 音频按讯飞语音评测要求切片、标识状态、
 *       并包装为 Base64 字符串，供 WebSocket 逐帧发送。
 *
 * 音频规范：
 *   - 采样率：16000 Hz
 *   - 位深：   16 bit
 *   - 声道：   单声道 (Mono)
 *   - 格式：   PCM (Raw) 或 WAV
 *
 * 每帧大小：1280 字节 → 对应 40ms 音频（16000×2÷1000×40 = 1280）
 */

// ========== 状态枚举 ==========

/** 帧顺序标识（三段式） */
export enum FrameStatus {
  FIRST_FRAME = 0,
  CONTINUE_FRAME = 1,
  LAST_FRAME = 2,
}

/** 音频发送状态（讯飞协议字段 aus） */
export enum AudioSendStatus {
  FIRST = 1,
  MIDDLE = 2,
  LAST = 4,
}

// ========== 切片接口 ==========

/** 单个音频切片，已转为 Base64 */
export interface AudioChunk {
  /** Base64 编码的音频数据 */
  data: string;
  /** 帧顺序状态 */
  status: FrameStatus;
  /** 音频发送状态 */
  aus: AudioSendStatus;
  /** 帧序号（从 0 开始） */
  index: number;
  /** 是否为末帧 */
  isLast: boolean;
}

// ========== 常量 ==========

/** 每帧 1280 字节 = 40ms @ 16kHz/16bit/Mono */
export const CHUNK_SIZE = 1280;

/** 推荐音频格式 */
export const AUDIO_SPEC = {
  sampleRate: 16000,
  bitDepth: 16,
  channels: 1,
  format: 'PCM' as const,
} as const;

// ========== 工具函数 ==========

/**
 * 将 Uint8Array 转换为 Base64 字符串
 */
function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

// ========== AudioStreamer 类 ==========

export class AudioStreamer {
  private totalChunks = 0;

  /**
   * 将音频 Buffer 切割为 Base64 编码的切片数组
   *
   * @param audioBuffer - PCM 16bit 音频数据（Uint8Array）
   * @returns 切片数组，每项包含 Base64 数据 + 状态标识
   *
   * 注意：
   *   - 单声道 16bit PCM 每秒 = 16000 × 2 = 32000 字节
   *   - 每帧 1280 字节 = 1280 / 32000 = 0.04s = 40ms
   *   - 总帧数 = Math.ceil(总字节数 / 1280)
   */
  slice(audioBuffer: Uint8Array): AudioChunk[] {
    const totalBytes = audioBuffer.length;
    const totalFrames = Math.ceil(totalBytes / CHUNK_SIZE);
    const chunks: AudioChunk[] = [];

    console.log('[AudioStreamer] 🎵 开始切片:', {
      totalBytes,
      totalFrames,
      chunkSize: CHUNK_SIZE,
      audioDurationMs: ((totalBytes / 32000) * 1000).toFixed(0),
    });

    for (let i = 0; i < totalFrames; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, totalBytes);
      const frame = audioBuffer.slice(start, end);

      // 不足 1280 字节的末帧用 0x00 填充
      let chunkData: Uint8Array;
      if (frame.length < CHUNK_SIZE) {
        chunkData = new Uint8Array(CHUNK_SIZE);
        chunkData.set(frame, 0);
        // 其余字节自动为 0
      } else {
        chunkData = frame;
      }

      const isLast = i === totalFrames - 1;

      // 确定帧状态
      let status: FrameStatus;
      let aus: AudioSendStatus;

      if (totalFrames === 1) {
        // 仅一帧 → 同时为首帧和尾帧
        status = FrameStatus.FIRST_FRAME;
        aus = AudioSendStatus.LAST; // 首帧即末帧
      } else if (i === 0) {
        status = FrameStatus.FIRST_FRAME;
        aus = AudioSendStatus.FIRST;
      } else if (isLast) {
        status = FrameStatus.LAST_FRAME;
        aus = AudioSendStatus.LAST;
      } else {
        status = FrameStatus.CONTINUE_FRAME;
        aus = AudioSendStatus.MIDDLE;
      }

      const base64 = uint8ToBase64(chunkData);

      chunks.push({
        data: base64,
        status,
        aus,
        index: i,
        isLast,
      });
    }

    this.totalChunks = totalFrames;
    console.log('[AudioStreamer] ✅ 切片完成:', { chunks: totalFrames });
    return chunks;
  }

  /**
   * 获取总切片数（切片后可用）
   */
  getTotalChunks(): number {
    return this.totalChunks;
  }
}
