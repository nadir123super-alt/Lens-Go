/**
 * TTS 缓存服务 - 管理 Edge TTS 音频和时间轴的本地缓存
 *
 * 缓存策略：
 * - 缓存键：文本内容的 MD5 哈希
 * - 缓存目录：FileSystem.cacheDirectory + 'tts_cache/'
 * - 缓存内容：audio.mp3 + timestamps.json
 */
import { createMD5 } from '@/utils/md5';
import * as FileSystem from 'expo-file-system/legacy';

interface TimestampWord {
  word: string;
  start_time: number;
  duration: number;
  char_offset?: number;
}

interface EdgeTtsResult {
  audioUri: string;
  timestamps: TimestampWord[];
  duration: number;
  text: string;
  createdAt: string;
}

const CACHE_DIR = `${FileSystem.cacheDirectory}tts_cache/`;

class TtsCacheService {
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;

    try {
      const dirInfo = await FileSystem.getInfoAsync(CACHE_DIR);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
      }
      this.initialized = true;
      console.log('[TtsCacheService] 缓存目录初始化成功');
    } catch (error) {
      console.error('[TtsCacheService] 缓存目录初始化失败:', error);
    }
  }

  private getCacheKey(text: string): string {
    return createMD5(text);
  }

  private getAudioPath(cacheKey: string): string {
    return `${CACHE_DIR}${cacheKey}.mp3`;
  }

  private getTimestampsPath(cacheKey: string): string {
    return `${CACHE_DIR}${cacheKey}.json`;
  }

  async get(text: string): Promise<EdgeTtsResult | null> {
    await this.init();

    const cacheKey = this.getCacheKey(text);
    const audioPath = this.getAudioPath(cacheKey);
    const timestampsPath = this.getTimestampsPath(cacheKey);

    try {
      const audioInfo = await FileSystem.getInfoAsync(audioPath);
      const timestampsInfo = await FileSystem.getInfoAsync(timestampsPath);

      if (!audioInfo.exists || !timestampsInfo.exists) {
        return null;
      }

      const timestampsContent = await FileSystem.readAsStringAsync(timestampsPath);
      const timestamps = JSON.parse(timestampsContent) as TimestampWord[];

      console.log(`[TtsCacheService] 缓存命中: "${text.substring(0, 30)}..."`);

      return {
        audioUri: audioPath,
        timestamps,
        duration: timestamps.length > 0
          ? timestamps[timestamps.length - 1].start_time + timestamps[timestamps.length - 1].duration
          : 0,
        text,
        createdAt: audioInfo.modificationTime?.toString() || new Date().toISOString(),
      };
    } catch (error) {
      console.warn('[TtsCacheService] 读取缓存失败:', error);
      return null;
    }
  }

  async set(text: string, audioUri: string, timestamps: TimestampWord[]): Promise<EdgeTtsResult | null> {
    await this.init();

    const cacheKey = this.getCacheKey(text);
    const destAudioPath = this.getAudioPath(cacheKey);
    const timestampsPath = this.getTimestampsPath(cacheKey);

    try {
      // 复制音频文件到缓存目录
      const audioInfo = await FileSystem.getInfoAsync(audioUri);
      if (audioInfo.exists) {
        await FileSystem.copyAsync({
          from: audioUri,
          to: destAudioPath,
        });
      } else {
        // 如果音频是 base64 或者网络 URI
        await FileSystem.copyAsync({
          from: audioUri,
          to: destAudioPath,
        }).catch(async () => {
          // 尝试直接写入
          const response = await fetch(audioUri);
          const blob = await response.blob();
          const base64 = await this.blobToBase64(blob);
          await FileSystem.writeAsStringAsync(destAudioPath, base64, {
            encoding: FileSystem.EncodingType.Base64,
          });
        });
      }

      // 保存时间轴
      const duration = timestamps.length > 0
        ? timestamps[timestamps.length - 1].start_time + timestamps[timestamps.length - 1].duration
        : 0;

      const cacheEntry: EdgeTtsResult = {
        audioUri: destAudioPath,
        timestamps,
        duration,
        text,
        createdAt: new Date().toISOString(),
      };

      await FileSystem.writeAsStringAsync(
        timestampsPath,
        JSON.stringify(timestamps, null, 2)
      );

      console.log(`[TtsCacheService] 缓存已保存: "${text.substring(0, 30)}..."`);
      return cacheEntry;
    } catch (error) {
      console.error('[TtsCacheService] 保存缓存失败:', error);
      return null;
    }
  }

  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        resolve(base64.split(',')[1] || '');
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async clear(): Promise<void> {
    await this.init();

    try {
      const files = await FileSystem.readDirectoryAsync(CACHE_DIR);
      for (const file of files) {
        await FileSystem.deleteAsync(`${CACHE_DIR}${file}`, { idempotent: true });
      }
      console.log('[TtsCacheService] 缓存已清除');
    } catch (error) {
      console.warn('[TtsCacheService] 清除缓存失败:', error);
    }
  }

  async getCacheSize(): Promise<number> {
    await this.init();

    try {
      const files = await FileSystem.readDirectoryAsync(CACHE_DIR);
      let totalSize = 0;

      for (const file of files) {
        const info = await FileSystem.getInfoAsync(`${CACHE_DIR}${file}`);
        if (info.exists && 'size' in info) {
          totalSize += info.size || 0;
        }
      }

      return totalSize;
    } catch (error) {
      return 0;
    }
  }
}

export const ttsCacheService = new TtsCacheService();
export type { EdgeTtsResult, TimestampWord };

