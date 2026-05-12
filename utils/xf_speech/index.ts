/**
 * xf_speech — 讯飞语音评测（流式版）WebAPI 集成
 *
 * 协议：wss://ise-api.xfyun.cn/v2/open-ise
 * 鉴权：HMAC-SHA256 签名（使用 crypto-js 库）
 *
 * 功能：对用户录音进行音素级发音评测，返回总分、各音素得分、
 *       语调/语速/完整度等维度的详细反馈。
 *
 * 参考文档：https://www.xfyun.cn/doc/Ise/Ise-API.html
 *
 * === 鉴权凭证传递说明 ===
 * React Native 的 process.env 只能读取 EXPO_PUBLIC_* 前缀变量。
 * 而 .env 中实际使用 EXPO_PUBLIC_IFLYTEK_* 存储讯飞凭证。
 * 因此 generateXFUrl() 改为显式接收 appId / apiKey / apiSecret 参数，
 * 由调用方（iflytekService.ts）传入 EXPO_PUBLIC_IFLYTEK_* 的值。
 */

import CryptoJS from 'crypto-js';

// Re-export from audioStreamer
export { AUDIO_SPEC, AudioSendStatus, AudioStreamer, CHUNK_SIZE, FrameStatus } from './audioStreamer';
export type { AudioChunk } from './audioStreamer';

// Re-export from businessParams
export { getBusinessParams, XF_PARAMS_DEFAULTS } from './businessParams';
export type { XFAue, XFBusinessParams, XFCategory, XFCustomConfig, XFEnt } from './businessParams';

// Re-export from xfiseClient
export { XFiseClient, XFiseError } from './xfiseClient';
export type { XFIseDimensionScores, XFIseResult } from './xfiseClient';

// Re-export from xfXmlParser
export { XFXmlParser } from './xfXmlParser';
export type {
  DetectedLanguage,
  DpMessageLabel,
  ParsedDimensions,
  ParsedIseResult,
  ParsedPhone,
  ParsedSyll,
  ParsedWord,
  WordErrorType
} from './xfXmlParser';

// ========== 常量 ==========
// 注意：这里不再导出 process.env.XF_*，因为 React Native 下不可用。
// 所有凭证由 iflytekService.ts 通过参数传入 generateXFUrl()。

const ISE_HOST = 'ise-api.xfyun.cn';
const ISE_PATH = '/v2/open-ise';
const ISE_URL = `wss://${ISE_HOST}${ISE_PATH}`;

// ========== 鉴权函数 ==========

/**
 * 生成 RFC1123 格式的 GMT 日期字符串
 * 示例："Thu, 07 May 2026 03:26:26 GMT"
 */
function getRFC1123Date(): string {
  return new Date().toUTCString();
}

/**
 * 生成讯飞 ISE WebSocket 鉴权 URL
 *
 * @param apiKey    讯飞 ISE API Key（来自 .env XF_API_KEY 或 EXPO_PUBLIC_IFLYTEK_API_KEY）
 * @param apiSecret 讯飞 ISE API Secret（来自 .env XF_API_SECRET 或 EXPO_PUBLIC_IFLYTEK_API_SECRET）
 * @returns 完整的带鉴权签名的 WebSocket URL wss://ise-api.xfyun.cn/v2/open-ise?host=...&date=...&authorization=...
 */
export function generateXFUrl(apiKey: string, apiSecret: string): string {
  const date = getRFC1123Date();
  const host = ISE_HOST;

  // Step 1: 构造签名字符串
  const signatureOrigin = `host: ${host}\ndate: ${date}\nGET ${ISE_PATH} HTTP/1.1`;

  // Step 2: HMAC-SHA256 加密 → Base64 编码
  const signatureWordArray = CryptoJS.HmacSHA256(signatureOrigin, apiSecret);
  const signature = CryptoJS.enc.Base64.stringify(signatureWordArray);

  // Step 3: 构造 Authorization 原始字符串
  const authorizationRaw =
    `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;

  // Step 4: Base64 编码整个 Authorization 字符串
  const authorizationWordArray = CryptoJS.enc.Utf8.parse(authorizationRaw);
  const authorization = CryptoJS.enc.Base64.stringify(authorizationWordArray);

  // Step 5: URL 编码各参数，拼接最终 URL
  const authParams =
    `host=${encodeURIComponent(host)}` +
    `&date=${encodeURIComponent(date)}` +
    `&authorization=${encodeURIComponent(authorization)}`;

  const url = `${ISE_URL}?${authParams}`;
  return url;
}

// ========== 文本处理函数 ==========

/**
 * 将普通字符串转换为符合讯飞要求的 Base64 编码
 *
 * 处理流程：
 *   1. 字符串 → UTF-8 编码字节
 *   2. 在字节流最前面添加 UTF-8 BOM 头（0xEF, 0xBB, 0xBF）
 *   3. 完整字节数组 → Base64 字符串
 *
 * 注意：讯飞语音评测 API 严格要求 text 参数必须带 BOM 头，
 *       否则将无法正确解析中英文混合内容。
 *
 * @param text - 待评测的文本内容（例如 "hello world" 或 "你好世界"）
 * @returns Base64 编码字符串，用于 WebSocket 的 text 参数
 */
export function prepareXFText(text: string): string {
  const BOM = [0xEF, 0xBB, 0xBF];

  // 1. 将字符串转换为 UTF-8 编码字节数组
  const encoder = new TextEncoder();
  const textBytes = encoder.encode(text);

  // 2. 拼接 BOM 头（3 字节） + UTF-8 文本字节
  const combined = new Uint8Array(BOM.length + textBytes.length);
  combined.set(BOM, 0);
  combined.set(textBytes, BOM.length);

  // 3. 字节数组 → 二进制字符串 → Base64
  let binary = '';
  combined.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  const base64 = btoa(binary);
  console.log('[xf_speech] 📝 文本已编码:', {
    original: text,
    base64Length: base64.length,
  });
  return base64;
}
