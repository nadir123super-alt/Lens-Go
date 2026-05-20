/**
 * tencentAsrService — 腾讯云语音识别 ASR (SentenceRecognition)
 *
 * 功能：
 * - 调用腾讯云一句话识别（SentenceRecognition）接口
 * - 实现 TC3-HMAC-SHA256 签名鉴权（API 3.0）
 * - 支持中英文混合识别（EngSerViceType: "16k_zh_en"）
 *
 * 环境变量：
 * - TENCENT_SECRET_ID: 腾讯云 API 密钥 ID
 * - TENCENT_SECRET_KEY: 腾讯云 API 密钥 Key
 *
 * 文档：
 * - https://cloud.tencent.com/document/api/1093/35646
 * - https://cloud.tencent.com/document/sdk/JavaScript
 */

import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

// ====== 配置 ======
const TENCENT_SECRET_ID = process.env.EXPO_PUBLIC_TENCENT_SECRET_ID || process.env.TENCENT_SECRET_ID || '';
const TENCENT_SECRET_KEY = process.env.EXPO_PUBLIC_TENCENT_SECRET_KEY || process.env.TENCENT_SECRET_KEY || '';
const ASR_ENDPOINT = 'asr.tencentcloudapi.com';
const ASR_SERVICE = 'asr';
const ASR_VERSION = '2019-06-14';
const ASR_REGION = 'ap-guangzhou';
const ASR_ACTION = 'SentenceRecognition';
const ASR_TIMEOUT_MS = 30000;

// ====== 纯 JS SHA256 & HMAC-SHA256（兼容 React Native，不依赖 crypto.subtle） ======

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

function ch(x: number, y: number, z: number): number {
  return (x & y) ^ (~x & z);
}

function maj(x: number, y: number, z: number): number {
  return (x & y) ^ (x & z) ^ (y & z);
}

function sigma0(x: number): number {
  return rotr(x, 2) ^ rotr(x, 13) ^ rotr(x, 22);
}

function sigma1(x: number): number {
  return rotr(x, 6) ^ rotr(x, 11) ^ rotr(x, 25);
}

function gamma0(x: number): number {
  return rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
}

function gamma1(x: number): number {
  return rotr(x, 17) ^ rotr(x, 19) ^ (x >>> 10);
}

const SHA256_K: number[] = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function sha256(message: Uint8Array): Uint8Array {
  const ml = message.length * 8;
  const paddedLen = (message.length + 9 + 63) & ~63;
  const padded = new Uint8Array(paddedLen);
  padded.set(message);
  padded[message.length] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 4, ml, false);

  let h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];

  for (let i = 0; i < paddedLen; i += 64) {
    const w = new Array(64);
    for (let t = 0; t < 16; t++) {
      w[t] = view.getUint32(i + t * 4, false);
    }
    for (let t = 16; t < 64; t++) {
      w[t] = (gamma1(w[t - 2]) + w[t - 7] + gamma0(w[t - 15]) + w[t - 16]) >>> 0;
    }

    let [a, b, c, d, e, f, g, hh] = h;

    for (let t = 0; t < 64; t++) {
      const T1 = (hh + sigma1(e) + ch(e, f, g) + SHA256_K[t] + w[t]) >>> 0;
      const T2 = (sigma0(a) + maj(a, b, c)) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + T1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (T1 + T2) >>> 0;
    }

    h = [
      (h[0] + a) >>> 0, (h[1] + b) >>> 0, (h[2] + c) >>> 0, (h[3] + d) >>> 0,
      (h[4] + e) >>> 0, (h[5] + f) >>> 0, (h[6] + g) >>> 0, (h[7] + hh) >>> 0,
    ];
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) {
    outView.setUint32(i * 4, h[i], false);
  }
  return out;
}

function hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array {
  const blockSize = 64;
  let keyBlock: Uint8Array;

  if (key.length > blockSize) {
    keyBlock = sha256(key);
  } else {
    keyBlock = key;
  }

  const paddedKey = new Uint8Array(blockSize);
  paddedKey.set(keyBlock);

  const ipad = new Uint8Array(blockSize);
  const opad = new Uint8Array(blockSize);
  for (let i = 0; i < blockSize; i++) {
    ipad[i] = paddedKey[i] ^ 0x36;
    opad[i] = paddedKey[i] ^ 0x5c;
  }

  const innerData = new Uint8Array(blockSize + data.length);
  innerData.set(ipad);
  innerData.set(data, blockSize);
  const innerHash = sha256(innerData);

  const outerData = new Uint8Array(blockSize + 32);
  outerData.set(opad);
  outerData.set(innerHash, blockSize);
  return sha256(outerData);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function strToUtf8(str: string): Uint8Array {
  const encoder = new TextEncoder();
  return encoder.encode(str);
}

// ====== 获取音频格式 ======
function getAudioFormat(): string {
  if (Platform.OS === 'android') {
    return 'amr'; // Android 使用 .3gp (AMR_NB)
  }
  return 'wav'; // iOS 使用 .wav (LINEARPCM)
}

// ====== 构建 TC3-HMAC-SHA256 签名 ======
function buildTc3Signature(
  secretId: string,
  secretKey: string,
  service: string,
  action: string,
  version: string,
  region: string,
  timestamp: number,
  payload: Record<string, any>
): { authorization: string; headers: Record<string, string> } {
  // 1. 构建 CanonicalRequest
  const httpMethod = 'POST';
  const canonicalUri = '/';
  const canonicalQueryString = '';
  const contentType = 'application/json';

  const signedHeaders = 'content-type;host';
  const requestPayload = JSON.stringify(payload);
  const hashedRequestPayload = bytesToHex(sha256(strToUtf8(requestPayload)));

  const canonicalRequest = [
    httpMethod,
    canonicalUri,
    canonicalQueryString,
    `content-type:${contentType}`,
    `host:${service}.tencentcloudapi.com`,
    '',
    signedHeaders,
    hashedRequestPayload,
  ].join('\n');

  // 2. 构建 StringToSign
  const algorithm = 'TC3-HMAC-SHA256';
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10).replace(/-/g, '');
  const credentialScope = `${date}/${service}/tc3_request`;
  const hashedCanonicalRequest = bytesToHex(sha256(strToUtf8(canonicalRequest)));

  const stringToSign = [
    algorithm,
    timestamp.toString(),
    credentialScope,
    hashedCanonicalRequest,
  ].join('\n');

  // 3. 计算 SigningKey
  const secretDate = hmacSha256(
    strToUtf8(`TC3${secretKey}`),
    strToUtf8(date)
  );
  const secretService = hmacSha256(secretDate, strToUtf8(service));
  const signingKey = hmacSha256(secretService, strToUtf8('tc3_request'));

  // 4. 计算 Signature
  const signatureBytes = hmacSha256(signingKey, strToUtf8(stringToSign));
  const signatureHex = bytesToHex(signatureBytes);

  // 5. 构建 Authorization
  const authorization = `${algorithm} Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signatureHex}`;

  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Host': `${service}.tencentcloudapi.com`,
    'X-TC-Action': action,
    'X-TC-Timestamp': timestamp.toString(),
    'X-TC-Version': version,
    'X-TC-Region': region,
    'Authorization': authorization,
  };

  return { authorization, headers };
}

// ====== 读取音频文件并转为 Base64 ======
async function readAudioAsBase64(audioUri: string): Promise<{ data: string; dataLen: number }> {
  try {
    const fileInfo = await FileSystem.getInfoAsync(audioUri);
    if (!fileInfo.exists) {
      throw new Error(`音频文件不存在: ${audioUri}`);
    }

    // 读取文件为 Base64
    const base64Content = await FileSystem.readAsStringAsync(audioUri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    // 获取文件大小
    const dataLen = (fileInfo as any).size || 0;

    return { data: base64Content, dataLen };
  } catch (error: any) {
    console.error('[TencentASR] 读取音频文件失败:', error.message);
    throw error;
  }
}

// ====== 调用腾讯云 ASR SentenceRecognition ======
/**
 * 将音频文件发送到腾讯云 ASR 进行一句话识别
 *
 * @param audioUri 本地音频文件 URI
 * @returns 识别后的文本
 */
export async function transcribeWithTencent(audioUri: string): Promise<string> {
  const secretId = TENCENT_SECRET_ID;
  const secretKey = TENCENT_SECRET_KEY;

  if (!secretId || !secretKey) {
    console.warn('[TencentASR] TENCENT_SECRET_ID 或 TENCENT_SECRET_KEY 未配置');
    throw new Error('TENCENT_ASR_NOT_CONFIGURED');
  }

  try {
    console.log('[TencentASR] 🎤 开始语音识别:', audioUri);

    // 1. 读取音频文件
    const { data, dataLen } = await readAudioAsBase64(audioUri);

    if (!data || dataLen === 0) {
      console.warn('[TencentASR] ⚠️ 音频文件为空');
      return '';
    }

    console.log(`[TencentASR] 音频大小: ${dataLen} bytes, 格式: ${getAudioFormat()}`);

    // 2. 构建请求参数
    const timestamp = Math.floor(Date.now() / 1000);
    // ★ 修复：根据平台选择正确的采样率服务
    // Android AMR-NB 编码后实际为 8kHz，必须使用 8k 服务
    // iOS PCM 为 16kHz，使用 16k 服务
    // 否则采样率不匹配会导致 ASR 解码失败
    const audioFormat = getAudioFormat();
    const engSerViceType = audioFormat === 'amr' ? '8k_zh' : '16k_zh_en';
    console.log(`[TencentASR] 音频格式: ${audioFormat}, 使用服务: ${engSerViceType}`);
    const payload = {
      EngSerViceType: engSerViceType,
      SourceType: 1,                 // 1: 本地语音上传
      VoiceFormat: audioFormat,      // 根据平台自动选择
      Data: data,                    // Base64 编码的音频数据
      DataLen: dataLen,              // 音频数据长度
    };

    // 3. 构建签名
    const { headers } = buildTc3Signature(
      secretId,
      secretKey,
      ASR_SERVICE,
      ASR_ACTION,
      ASR_VERSION,
      ASR_REGION,
      timestamp,
      payload
    );

    // 4. 发送请求
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ASR_TIMEOUT_MS);

    try {
      const response = await fetch(`https://${ASR_ENDPOINT}`, {
        method: 'POST',
        headers: {
          ...headers,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const responseText = await response.text();
      let result: any;
      try {
        result = JSON.parse(responseText);
      } catch {
        console.error('[TencentASR] 响应解析失败:', responseText);
        throw new Error('ASR_RESPONSE_PARSE_ERROR');
      }

      // 5. 检查错误
      if (!response.ok) {
        const errorMsg = result?.Response?.Error?.Message || response.statusText;
        console.error(`[TencentASR] API 请求失败 (${response.status}):`, errorMsg);
        throw new Error(`ASR_API_ERROR: ${errorMsg}`);
      }

      // 6. 提取识别结果
      const transcribedText = result?.Response?.Result || '';

      if (!transcribedText || transcribedText.trim().length === 0) {
        console.warn('[TencentASR] ⚠️ 识别结果为空');
        return '';
      }

      console.log('[TencentASR] ✅ 识别结果:', transcribedText);
      return transcribedText.trim();
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        console.error('[TencentASR] 请求超时');
        throw new Error('ASR_TIMEOUT');
      }
      throw error;
    }
  } catch (error: any) {
    console.error('[TencentASR] ❌ 语音识别失败:', error.message);

    // 如果是空音频错误，返回空字符串
    if (error.message === 'EMPTY_AUDIO') {
      return '';
    }

    // 其他错误也返回空，让上层决定如何处理
    return '';
  }
}
