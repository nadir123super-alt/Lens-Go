/**
 * XFiseClient — 讯飞语音评测（流式版）WebSocket 客户端
 *
 * 管理与 ISE API 的完整通信生命周期：
 *   1. WebSocket 连接（鉴权 URL）
 *   2. 三段式发送：首帧(common+business) → 持续帧(音频切片) → 尾帧(结束标记)
 *   3. 超时断开（5 秒无响应）
 *   4. 累积中间帧 data.data → Base64 解码 → XML 评测结果
 *
 * onMessage 增强逻辑：
 *   - code !== 0 → 立即报错并打印完整 message
 *   - 中间帧 → resultBuffer 缓存所有 data.data 字段
 *   - status === 2 → 合并所有 data.data → Base64 解码 → 原生 XML 字符串
 *   - 从 XML 中提取总分和维度分
 *
 * 参考文档：https://www.xfyun.cn/doc/Ise/Ise-API.html
 */


import { getCurrentAudioEncoding } from '../../services/recordingService';
import { type AudioChunk } from './audioStreamer';
import type { XFAue, XFBusinessParams } from './businessParams';
import { XFXmlParser, type ParsedIseResult } from './xfXmlParser';

// ========== 常量 ==========

/** 服务器响应超时（毫秒） */
const RESPONSE_TIMEOUT_MS = 5000;

/** 帧间发送间隔（毫秒），约 40ms 一帧 */
const CHUNK_SEND_INTERVAL_MS = 40;

// ========== 音频编码配置类型 ==========

/**
 * 讯飞 ISE 音频编码配置
 * 与 recordingService 的录音配置保持同步
 *
 * 统一 PCM 16kHz:
 *   encoding: 'raw', format: 'audio/L16;rate=16000', sampleRate: 16000
 */
export interface XFiseAudioConfig {
  /** 编码类型（对应讯飞 API aue 参数） */
  encoding: XFAue;
  /** 音频格式字符串（对应讯飞 API data.format） */
  format: string;
  /** 采样率 */
  sampleRate: number;
}

// ========== 结果类型 ==========

/** 讯飞评测返回的维度分数（兼容旧代码） */
export type XFIseDimensionScores = {
  accuracy_score?: number;
  fluency_score?: number;
  integrity_score?: number;
  total_score?: number;
};

/** 最终评测结果（扩展 ParsedIseResult，增加 raw/xml/isRejected 字段） */
export interface XFIseResult extends ParsedIseResult {
  /** 服务端原始响应 (调试用) */
  raw: Record<string, any>;
  /** Base64 解码后的原始 XML (如已解码) */
  xml?: string;
  /**
   * 引擎是否拒绝了本次评测（is_rejected="true"）
   * 
   * 常见原因：
   * - 音频格式不兼容（如 AMR 用 aue=raw 发送）
   * - 音频数据量过小（静音/数据截断）
   * - 服务端解码失败
   * 
   * 当 isRejected=true 时，返回的分数为全零，调用方应触发 IAT fallback
   */
  isRejected?: boolean;
}

// ========== 错误类型 ==========

export class XFiseError extends Error {
  constructor(
    message: string,
    public code?: number,
  ) {
    super(message);
    this.name = 'XFiseError';
  }
}

// ========== Base64 工具 ==========

/**
 * Base64 解码 → 原始文本 (UTF-8)
 */
function base64Decode(base64Str: string): string {
  try {
    const binaryStr = atob(base64Str);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(bytes);
  } catch {
    return '';
  }
}

// ========== XFiseClient 类 ==========

export class XFiseClient {
  private ws: WebSocket | null = null;
  private url: string;
  private appId: string;
  private responseTimer: ReturnType<typeof setTimeout> | null = null;
  private finished = false;

  constructor(url: string, appId: string) {
    this.url = url;
    this.appId = appId;
  }

  /**
   * 核心评测方法：连接 → 发送 → 等待结果
   *
   * @param businessParams - 业务参数（含 text Base64）
   * @param audioChunks    - AudioStreamer 切好的音频帧数组
   * @param audioConfig    - 音频编码配置（与 recordingService 保持同步）
   * @returns 评测结果（含 XML 字符串）
   */
  evaluate(
    businessParams: XFBusinessParams,
    audioChunks: AudioChunk[],
    audioConfig?: XFiseAudioConfig,
  ): Promise<XFIseResult> {
    // 默认配置：从 recordingService 同步当前平台的音频编码
    const defaultEncoding = getCurrentAudioEncoding();
    const cfg: XFiseAudioConfig = audioConfig ?? {
      encoding: defaultEncoding.encoding as XFAue,
      format: defaultEncoding.format,
      sampleRate: defaultEncoding.sampleRate,
    };

    console.log('[XFiseClient] 🎵 音频编码配置:', cfg);
    // businessParams.aue 需要与 data.encoding 一致
    // 将 cfg.encoding 覆写到 businessParams（确保两处一致）
    businessParams = { ...businessParams, aue: cfg.encoding };
    return new Promise((resolve, reject) => {
      if (!this.url) {
        reject(new XFiseError('WebSocket URL 为空，请先调用 generateXFUrl()'));
        return;
      }

      if (audioChunks.length === 0) {
        reject(new XFiseError('音频切片为空'));
        return;
      }

      // 结果缓冲区：收集所有中间帧的 data.data 字段
      const resultBuffer: string[] = [];

      console.log('[XFiseClient] 🔗 连接 ISE 服务器:', {
        urlPrefix: this.url.substring(0, 60) + '...',
        chunks: audioChunks.length,
        totalBytes: audioChunks.reduce((sum, c) => sum + c.data.length, 0),
      });

      const ws = new WebSocket(this.url);
      this.ws = ws;
      this.finished = false;

      // ===== 超时处理 =====
      const startTimeout = () => {
        this.clearTimeout();
        this.responseTimer = setTimeout(() => {
          if (!this.finished) {
            this.finished = true;
            ws.close();
            reject(new XFiseError('讯飞评测超时（5 秒内未收到响应）'));
          }
        }, RESPONSE_TIMEOUT_MS);
      };

      // ===== onopen =====
      ws.onopen = () => {
        console.log('[XFiseClient] ✅ WebSocket 已连接，发送首帧 (status:0)');

        // 发送首帧：status=0，含 common + business，不含音频
        // 按讯飞文档要求：
        //   - business.cmd: "ssb" (参数上传阶段)
        //   - business.sub: "ise" (服务类型)
        //   - business.ttp_skip: true (跳过 ttp 阶段)
        //   - data: { status: 0 } (只需 status 字段，见 API 文档示例)
        //   - text: 必须是 BOM + 纯文本字符串（非 Base64！）
        //
        // 文档示例：
        // {
        //   "common": { "app_id": "xxxx" },
        //   "business": {
        //     "cmd": "ssb", "sub": "ise", ...,
        //     "text": "[content]When you don't know..."
        //   },
        //   "data": { "status": 0 }
        // }
        const firstFrame = {
          common: { app_id: this.appId },
          business: {
            cmd: 'ssb',
            sub: 'ise',
            ent: businessParams.ent,
            category: businessParams.category,
            aue: businessParams.aue,
            text: businessParams.text,
            tte: 'utf-8',
            auf: cfg.format,
            ttp_skip: true,
            rstcd: 'utf8',
          },
          data: {
            status: 0,
            data: '',
          },
        };

        try {
          ws.send(JSON.stringify(firstFrame));
        } catch (err: any) {
          this.cleanup(reject, new XFiseError(`首帧发送失败: ${err.message}`));
          return;
        }

        // 启动超时计时
        startTimeout();

        // 开始发送音频切片
        let chunkIndex = 0;

        const sendNextChunk = () => {
          if (this.finished || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

          if (chunkIndex >= audioChunks.length) {
          // 所有切片已发送完毕，发送结束信号
          // 参考 API 文档：结束帧仅需 business.cmd="auw", business.aus=4, data.status=2, data=""
          // 与 Java Demo 保持一致：
          //   .add("business", "cmd", "auw").add("business", "aus", 4)
          //   .add("data", "status", 2).add("data", "data", "")
          console.log('[XFiseClient] 📤 音频切片发送完毕，发送结束信号 (status:2, aus:4)');
          const endFrame = {
            business: {
              cmd: 'auw',
              aus: 4,
              aue: cfg.encoding,
            },
            data: {
              status: 2,
              data_type: 1,
              data: '',
            },
          };
            try {
              ws.send(JSON.stringify(endFrame));
            } catch (err: any) {
              this.cleanup(reject, new XFiseError(`结束帧发送失败: ${err.message}`));
            }
            return;
          }

          // 发送当前音频帧
          const chunk = audioChunks[chunkIndex];
          const isFirst = chunkIndex === 0;

          // 文档要求（与 Java Demo 一致）：
          //   第一帧音频: cmd="auw", aus=1, data.status=1, data=音频数据
          //   中间帧音频: cmd="auw", aus=2, data.status=1, data=音频数据
          //   最后帧音频: cmd="auw", aus=2, data.status=1, data=音频数据
          //   音频发完后：cmd="auw", aus=4, data.status=2, data=""（空结束帧）
          //
          // Java Demo 中每个音频帧还包含:
          //   business.aue（与首帧相同的 aue 值）
          //   data.data_type = 1
          //   data.encoding（与首帧相同的 encoding 值）
          const aus = isFirst ? 1 : 2;  // 仅第一帧 aus=1，其余全部 aus=2
          const audioFrame = {
            business: {
              cmd: 'auw',
              aus,
              aue: cfg.encoding,
            },
            data: {
              status: 1,
              data_type: 1,
              encoding: cfg.encoding,
              data: chunk.data,
            },
          };

          try {
            ws.send(JSON.stringify(audioFrame));
            console.log(`[XFiseClient] 📤 发送音频帧 #${chunkIndex + 1}/${audioChunks.length} (aus=${aus}, data=${chunk.data.substring(0, 40)}...)`);
          } catch (err: any) {
            this.cleanup(reject, new XFiseError(`音频帧 #${chunkIndex + 1} 发送失败: ${err.message}`));
            return;
          }

          chunkIndex++;
          // 每帧间隔 ~40ms (模拟实时流)
          setTimeout(sendNextChunk, 40);
        };

        // 延迟一小段时间后开始发送音频（给服务器处理首帧的时间）
        setTimeout(sendNextChunk, 100);
      };

      // ===== onmessage（增强版） =====
      ws.onmessage = (event: WebSocketMessageEvent) => {
        try {
          const result = JSON.parse(event.data as string);

          console.log('[XFiseClient] 📩 收到响应:', {
            code: result.code,
            status: result.data?.status,
            message: result.message,
            hasData: !!result.data?.data,
            dataLength: typeof result.data?.data === 'string' ? result.data.data.length : 0,
          });

          // 重置超时计时（每次收到消息都重置）
          startTimeout();

          // ===== 状态检查：code !== 0 → 立即报错并打印详细 message =====
          if (result.code !== 0) {
            const errMsg = result.message || `讯飞服务返回错误`;
            const errCode = result.code;

            // 详细打印错误信息，方便排查
            console.error(`[XFiseClient] ❌ 服务器返回错误: code=${errCode}, message="${errMsg}"`);
            console.error(`[XFiseClient] ❌ 完整错误帧:`, JSON.stringify(result).substring(0, 800));

            this.cleanup(reject, new XFiseError(
              `${errMsg} (code: ${errCode})`,
              errCode,
            ));
            return;
          }

          // ===== 中间数据捕获：将 data.data 追加到 resultBuffer =====
          const rawData = result.data?.data;
          if (typeof rawData === 'string' && rawData.length > 0) {
            resultBuffer.push(rawData);
            console.log(`[XFiseClient] 📥 缓存中间数据 (第 ${resultBuffer.length} 段): ${rawData.length} 字节`);
          }

          // ===== 结束判定：status === 2 表示评测完成 =====
          if (result.data?.status === 2) {
            console.log(`[XFiseClient] ✅ 评测完成，共收到 ${resultBuffer.length} 段数据`);

            // 合并所有 data.data 片段
            const combinedBase64 = resultBuffer.join('');
            console.log(`[XFiseClient] 📦 合并 Base64: ${combinedBase64.length} 字节`);

            // Base64 解码 → 原始 XML 字符串
            const xmlString = base64Decode(combinedBase64);
            console.log(`[XFiseClient] 📄 解码后 XML (前 500 字符):`, xmlString.substring(0, 500));

            // 从 XML 中提取分数
            const iseResult = this.parseResultFromXml(xmlString, result);
            this.cleanup(resolve, iseResult);
          }
        } catch (parseErr: any) {
          console.warn('[XFiseClient] ⚠️ 消息解析失败:', parseErr);
        }
      };

      // ===== onerror =====
      ws.onerror = (event: Event) => {
        console.error('[XFiseClient] ❌ WebSocket 错误:', event);
        this.cleanup(reject, new XFiseError('WebSocket 连接失败'));
      };

      // ===== onclose =====
      ws.onclose = (event: WebSocketCloseEvent) => {
        console.log(`[XFiseClient] 🔌 WebSocket 关闭: code=${event.code}`);
        if (!this.finished) {
          this.cleanup(reject, new XFiseError(`WebSocket 意外关闭 (code: ${event.code})`));
        }
      };
    });
  }

  /**
   * 使用 XFXmlParser 解析 ISE 返回的 XML
   *
   * 健壮性保证：
   *   - 通过 try-catch 包裹，解析失败不会抛异常导致 app 崩溃
   *   - 开发环境下打印解析后的完整 JSON 和原始 XML，便于调试对比
   *   - 合并处理：在 status===2 时才调用，此时所有数据片段已拼接完成
   */
  private parseResultFromXml(
    xmlString: string,
    rawResult: Record<string, any>,
  ): XFIseResult {
    // 开发环境诊断：打印原始 XML + 解析后的 JSON
    if (__DEV__) {
      console.log('[XFiseClient] 🔍 ===== 原始 XML (调试) =====');
      console.log(xmlString);
      console.log('[XFiseClient] 🔍 ===== 原始 XML 结束 =====');
    }

    let parsed: ParsedIseResult;
    try {
      parsed = XFXmlParser.parseSync(xmlString);
    } catch (err: any) {
      // XFXmlParser.parseSync 应该已内部捕获，这是双重保险
      console.error('[XFiseClient] ❌ parseResultFromXml 异常（双重捕获）:', err?.message);
      parsed = {
        totalScore: 0,
        dimensions: { total_score: 0, accuracy_score: 0, fluency_score: 0, integrity_score: 0 },
        words: [],
        detectedLanguage: 'unknown',
        scoreNormalized: false,
        rawParsed: {},
        error: `parseResultFromXml 异常: ${err?.message ?? String(err)}`,
      };
    }

    // 开发环境：打印解析后的完整 JSON，方便对比原始 XML
    if (__DEV__) {
      console.log('[XFiseClient] 🔍 ===== 解析后 JSON (调试) =====');
      console.log(JSON.stringify({
        totalScore: parsed.totalScore,
        dimensions: parsed.dimensions,
        detectedLanguage: parsed.detectedLanguage,
        scoreNormalized: parsed.scoreNormalized,
        error: parsed.error,
        wordCount: parsed.words.length,
        words: parsed.words.map(w => ({
          text: w.text,
          score: w.score,
          errorType: w.errorType,
          errorLabel: w.errorLabel,
          syllCount: w.sylls?.length ?? 0,
          phoneCount: w.phones?.length ?? 0,
        })),
      }, null, 2));
      console.log('[XFiseClient] 🔍 ===== 解析后 JSON 结束 =====');
    }

    // ===== 检测 is_rejected（引擎拒绝评测） =====
    // XML 中可能出现：<read_word is_rejected="true"> 或 <read_sentence is_rejected="true">
    // 这种情况下分数全为 0，应触发 IAT fallback
    const isRejected = /is_rejected\s*=\s*"true"/i.test(xmlString);

    if (isRejected) {
      console.warn('[XFiseClient] ⚠️ 引擎拒绝本次评测 (is_rejected=true)，分数不可信，应触发 IAT fallback');
    }

    // 记录解析摘要
    console.log('[XFiseClient] 📊 解析摘要:', {
      totalScore: parsed.totalScore,
      dimensions: parsed.dimensions,
      wordCount: parsed.words.length,
      errorWords: parsed.words.filter(w => w.errorType !== 'normal').length,
      error: parsed.error || '(无)',
      isRejected,
    });

    return {
      ...parsed,
      raw: rawResult,
      xml: xmlString,
      isRejected,
    };
  }

  /**
   * 清理资源，完成 Promise
   */
  private cleanup(
    settle: ((value: XFIseResult) => void) | ((reason: any) => void),
    value: XFIseResult | XFiseError,
  ): void {
    if (this.finished) return;
    this.finished = true;

    this.clearTimeout();

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.close();
      } catch {}
    }
    this.ws = null;

    // settle 可能是 resolve 或 reject
    (settle as any)(value);
  }

  private clearTimeout(): void {
    if (this.responseTimer) {
      clearTimeout(this.responseTimer);
      this.responseTimer = null;
    }
  }
}
