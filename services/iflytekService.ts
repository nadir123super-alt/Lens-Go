/**
 * iflytekService — 讯飞语音听写 WebSocket WebAPI 集成 + ISE 评测集成
 *
 * 两套 API：
 *   1. IAT (iat-api.xfyun.cn/v2/iat) — 语音转写（听写）
 *   2. ISE (ise-api.xfyun.cn/v2/open-ise) — 语音评测（发音评估）
 *
 * 音频格式处理：
 *   - iOS WAV PCM:      strip 44字节 header → raw PCM s16le
 *   - Android 3GP/AMR:  skip 3GP container → extract raw AMR bitstream
 *   - IAT API 仅支持 encoding=raw/speex/speex-wb，不支持 amr-nb；
 *     因此 Android 上 IAT 固定 encoding='raw' 并发送提取后的音频字节流
 *   - ISE API 原生支持 aue=amr-nb，因此 Android 上发送 raw AMR bitstream
 *     并指定 encoding/format 为 AMR 类型
 */

import * as FileSystem from 'expo-file-system/legacy';
import { getCurrentAudioEncoding } from './recordingService';
import { cleanTextForSpeech } from './textCleaner';

// ========== 莱文斯坦编辑距离打分（仅 IAT 回退用） ==========

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,!?;:'"(){}[\]«»-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + 1);
      }
    }
  }
  return dp[m][n];
}

function levenshteinScore(recognized: string, target: string): number {
  const normRecognized = normalize(recognized);
  const normTarget = normalize(target);
  if (!normRecognized) return 0;
  if (!normTarget) return 0;
  const distance = levenshteinDistance(normRecognized, normTarget);
  const maxLen = Math.max(normRecognized.length, normTarget.length);
  const errorRatio = distance / maxLen;
  const rawScore = Math.round((1 - errorRatio) * 100);
  return Math.max(0, Math.min(100, rawScore));
}

// ========== 配置（从 .env 读取） ==========
// 讯飞凭证来源：XF_APP_ID / XF_API_KEY / XF_API_SECRET
// React Native / Expo 下 process.env 只暴露 EXPO_PUBLIC_ 前缀变量，
// 因此使用 EXPO_PUBLIC_XF_* 作为运行时可访问的变量名（与 .env 中的 XF_* 值一致）

const IFLYTEK_APP_ID = process.env.EXPO_PUBLIC_XF_APP_ID || process.env.XF_APP_ID || '';
const IFLYTEK_API_KEY = process.env.EXPO_PUBLIC_XF_API_KEY || process.env.XF_API_KEY || '';
const IFLYTEK_API_SECRET = process.env.EXPO_PUBLIC_XF_API_SECRET || process.env.XF_API_SECRET || '';

const IAT_HOST = 'iat-api.xfyun.cn';
const IAT_PATH = '/v2/iat';
const IAT_URL = `wss://${IAT_HOST}${IAT_PATH}`;

// ========== 纯 JS SHA256 & HMAC-SHA256 ==========

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

function strToUtf8(str: string): Uint8Array {
  const encoder = new TextEncoder();
  return encoder.encode(str);
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

function base64Encode(bytes: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes[i];
    const b2 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b3 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    result += chars[b1 >> 2];
    result += chars[((b1 & 0x03) << 4) | (b2 >> 4)];
    result += i + 1 < bytes.length ? chars[((b2 & 0x0f) << 2) | (b3 >> 6)] : '=';
    result += i + 2 < bytes.length ? chars[b3 & 0x3f] : '=';
  }
  return result;
}

function base64UrlEncode(str: string): string {
  const bytes = strToUtf8(str);
  return base64Encode(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// ========== 讯飞 IAT 鉴权 URL 构造 ==========

function buildIatAuthUrl(): string {
  const host = IAT_HOST;
  const date = new Date().toUTCString();
  const signatureOrigin = `host: ${host}\ndate: ${date}\nGET ${IAT_PATH} HTTP/1.1`;

  const signatureBytes = hmacSha256(strToUtf8(IFLYTEK_API_SECRET), strToUtf8(signatureOrigin));
  const signature = base64Encode(signatureBytes);

  const authorizationRaw = `api_key="${IFLYTEK_API_KEY}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;
  const authorization = base64Encode(strToUtf8(authorizationRaw));

  const authParams = `host=${encodeURIComponent(host)}&date=${encodeURIComponent(date)}&authorization=${encodeURIComponent(authorization)}`;
  return `${IAT_URL}?${authParams}`;
}

// ========== 音频文件读取 ==========

const WAV_HEADER_SIZE = 44;
const PCM_BYTES_PER_SEC = 32000; // 16kHz * 16bit * 1 channel = 32000 bytes/s
const AMR_NB_BYTES_PER_SEC = 1625; // 8kHz AMR_NB ≈ 12.2kbps → ~1525 bytes/s (含帧头) + margin ≈ 1625

/**
 * PCM 数字增益放大 — 将 16-bit signed PCM 采样值乘以增益系数
 * 用于放大远距离/低音量录音，提高讯飞 API 的识别率
 *
 * @param pcmData 原始 PCM 数据（16-bit signed little-endian）
 * @param gain 增益系数（建议 2.0~4.0，过大可能导致削波失真）
 * @returns 增益后的 PCM 数据
 */
function amplifyPCM(pcmData: Uint8Array, gain: number): Uint8Array {
  if (gain <= 1.0 || pcmData.length < 2) return pcmData;
  
  const samples = new Int16Array(pcmData.buffer, pcmData.byteOffset, pcmData.byteLength / 2);
  let maxSample = 0;
  let hasSignal = false;
  
  // 先扫描一遍，检测是否有有效信号并计算最大振幅
  for (let i = 0; i < samples.length; i++) {
    const absVal = Math.abs(samples[i]);
    if (absVal > 50) hasSignal = true; // 大于 50 视为有效信号（非底噪）
    if (absVal > maxSample) maxSample = absVal;
  }
  
  // 如果没有有效信号或信号已经很大，不做增益
  if (!hasSignal) return pcmData;
  if (maxSample > 30000) return pcmData; // 信号已经接近满幅，再放大会削波
  
  // 动态计算增益：目标是将最大振幅提升到 20000 左右（留有余量避免削波）
  // 但不超过 4.0 倍
  const targetAmplitude = Math.min(20000, maxSample * gain);
  const effectiveGain = Math.min(gain, targetAmplitude / Math.max(maxSample, 1));
  
  console.log(`[iflytekService] 🔊 PCM 增益: gain=${effectiveGain.toFixed(2)}x (maxSample=${maxSample}, target=${targetAmplitude})`);
  
  // 应用增益
  for (let i = 0; i < samples.length; i++) {
    let amplified = Math.round(samples[i] * effectiveGain);
    // 钳制到 16-bit 范围
    amplified = Math.max(-32768, Math.min(32767, amplified));
    samples[i] = amplified;
  }
  
  return new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
}

/**
 * 读取录音文件，根据平台和格式剥离容器头，返回音频负载字节流
 *
 * iOS:   WAV RIFF 容器 → 剥离 44 字节 WAV 头 → raw PCM s16le
 * Android: 3GP 容器 (AMR_NB) → 提取 AMR 裸帧数据
 *
 * 验证规则：
 *   - PCM: 数据量 < 512 bytes → 报错
 *   - AMR: 数据量 < 50 bytes → 报错
 *
 * 3GP 解析策略（按优先级）：
 *   1. 迭代遍历所有 box（ftyp → moov → mdat），定位实际数据
 *   2. 单步跳过所有已知 box header 后，剩余部分视为数据
 *   3. 最终兜底：跳过文件前 400 bytes（典型 3GP header 大小）
 */
/**
 * 解析 3GP/MP4 容器的 box 结构，提取 mdat box 中的数据
 *
 * 3GP 文件结构：
 *   [ftyp box] → [moov box] → [mdat box] (AMR 音频数据)
 *   每个 box: [4 bytes size][4 bytes type][payload...]
 *   如果 size=1: [4 bytes size=1][4 bytes type][8 bytes extended_size][payload...]
 *
 * @param bytes 完整的文件字节数组
 * @param fileSize 文件大小
 * @returns 提取的 mdat payload（原始 AMR 帧数据，不含 AMR magic 头）
 */
function extractMdatFrom3gp(bytes: Uint8Array, fileSize: number): Uint8Array | null {
  let offset = 0;
  const maxBoxes = 30;
  
  for (let i = 0; i < maxBoxes && offset + 8 <= fileSize; i++) {
    // 读取 box size (big-endian uint32)
    const boxSize =
      ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
    
    // 读取 box type (4 ASCII chars)
    const boxType = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    
    console.log(`[iflytekService] 📦 Box[${offset}]: type="${boxType}" size=${boxSize}`);
    
    // 计算实际 box 大小和 data 偏移
    let actualBoxSize: number;
    let dataOffset: number;
    
    if (boxSize === 1) {
      // 扩展尺寸格式：8 bytes header + 8 bytes extended_size
      if (offset + 16 > fileSize) break;
      // 使用 BigInt 避免精度丢失
      const hi = ((bytes[offset + 8] << 24) | (bytes[offset + 9] << 16) | (bytes[offset + 10] << 8) | bytes[offset + 11]) >>> 0;
      const lo = ((bytes[offset + 12] << 24) | (bytes[offset + 13] << 16) | (bytes[offset + 14] << 8) | bytes[offset + 15]) >>> 0;
      // 对于 3GP 文件，mdat 大小通常不会超过 2^53，使用 Number 是安全的
      actualBoxSize = hi * 0x100000000 + lo;
      dataOffset = offset + 16;
      console.log(`[iflytekService] 📏 扩展尺寸 box: hi=${hi}, lo=${lo}, actualBoxSize=${actualBoxSize}`);
    } else if (boxSize === 0) {
      // size=0 表示 box 延伸到文件末尾
      actualBoxSize = fileSize - offset;
      dataOffset = offset + 8;
      console.log(`[iflytekService] 📏 size=0, 延伸到文件末尾: actualBoxSize=${actualBoxSize}`);
    } else {
      actualBoxSize = boxSize;
      dataOffset = offset + 8;
    }
    
    if (boxType === 'mdat') {
      // 找到 mdat box，提取数据
      const payloadEnd = Math.min(offset + actualBoxSize, fileSize);
      const payload = bytes.slice(dataOffset, payloadEnd);
      console.log(`[iflytekService] ✅ 找到 mdat box: dataOffset=${dataOffset}, payload=${payload.length} bytes (boxEnd=${payloadEnd})`);
      return payload;
    }
    
    // 跳到下一个 box
    if (actualBoxSize >= 8 && actualBoxSize <= fileSize - offset) {
      offset += actualBoxSize;
    } else {
      console.warn(`[iflytekService] ⚠️ Box "${boxType}" 大小异常 (${actualBoxSize}), 跳过 1 byte`);
      offset += 1;
    }
  }
  
  return null; // 未找到 mdat
}

async function readAudioFile(fileUri: string): Promise<Uint8Array> {
  const { encoding, extension } = getCurrentAudioEncoding();

  const base64 = await FileSystem.readAsStringAsync(fileUri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  // 诊断：检查 base64 字符串是否有效
  if (!base64 || base64.length === 0) {
    throw new Error(`AUDIO_DATA_TOO_SMALL: 录音文件为空 (base64=0 bytes)`);
  }

  const binaryStr = atob(base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }

  const originalSize = bytes.length;
  const fileExt = fileUri.toLowerCase().endsWith('.3gp') ? '.3gp' : extension;
  console.log(`[iflytekService] 📁 读取音频文件: ${originalSize} bytes (${(originalSize / 1024).toFixed(1)} KB) | ext=${fileExt} | encoding=${encoding}`);

  if (originalSize === 0) {
    throw new Error('AUDIO_DATA_TOO_SMALL: 录音文件为空（0 bytes）');
  }

  // 检测文件类型
  const magicBytes = bytes.slice(0, 4);
  const magicHex = Array.from(magicBytes).map(b => b.toString(16).padStart(2, '0')).join(' ');

  // ★ 诊断：打印文件前 64 bytes 的 hex dump，用于排查 3GP 解析问题
  const hexDump = Array.from(bytes.slice(0, Math.min(64, bytes.length)))
    .map(b => b.toString(16).padStart(2, '0')).join(' ');
  console.log(`[iflytekService] 🔬 文件前 64 bytes hex: ${hexDump}`);

  // 3GP/MP4 文件检测: ftyp box 位于偏移 4 处，字节 4-7 为 "ftyp"
  const hasFtyp = bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
  const isRiff = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
  const isWave = isRiff && (bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45);

  let audioPayload: Uint8Array = new Uint8Array(0);

  if (hasFtyp || fileExt === '.3gp') {
    // ============================================================
    // Android 3GP 容器处理 — 使用健壮的 extractMdatFrom3gp()
    // ============================================================
    console.log(`[iflytekService] 🔍 检测到 3GP/MP4 容器 (magic: ${magicHex})，提取 AMR 数据`);

    // 策略 1: 使用 extractMdatFrom3gp 精确解析 box 结构
    let mdatPayload = extractMdatFrom3gp(bytes, originalSize);

    // 策略 2: 如果精确解析失败，使用迭代跳过所有 box header 的兜底策略
    if (!mdatPayload || mdatPayload.length < 50) {
      console.warn(`[iflytekService] ⚠️ extractMdatFrom3gp 未找到有效 mdat (payload=${mdatPayload?.length || 0}), 尝试迭代兜底`);
      
      // 跳过所有已知 box
      let skipOffset = 0;
      while (skipOffset + 8 < originalSize) {
        const sz = ((bytes[skipOffset] << 24) | (bytes[skipOffset + 1] << 16) | (bytes[skipOffset + 2] << 8) | bytes[skipOffset + 3]) >>> 0;
        const tp = String.fromCharCode(bytes[skipOffset + 4], bytes[skipOffset + 5], bytes[skipOffset + 6], bytes[skipOffset + 7]);
        if (sz < 8 || sz > originalSize - skipOffset || tp === 'mdat') {
          skipOffset += 8;
          break;
        }
        skipOffset += sz;
      }
      mdatPayload = bytes.slice(Math.min(skipOffset, originalSize));
      console.log(`[iflytekService] ℹ️ 迭代兜底: offset=${skipOffset}, payload=${mdatPayload.length} bytes`);
    }

    // 策略 3: 最终兜底 — 跳过文件前 400 bytes
    if (mdatPayload.length < 50) {
      const fallbackOffset = Math.min(400, Math.floor(originalSize * 0.3));
      console.warn(`[iflytekService] ⚠️ 最终兜底: 跳过 ${fallbackOffset} bytes (原 payload=${mdatPayload.length})`);
      mdatPayload = bytes.slice(fallbackOffset);
    }

    audioPayload = mdatPayload;

    // ⚠️ 3GP 容器内的 AMR 数据没有魔数头
    // ISE/IAT API 需要带这个头才能正确识别格式（isAmrData()/detectAmrType() 依赖它）
    // 根据当前平台编码动态选择 AMR-NB 的魔数
    // AMR-NB: "#!AMR\n" (6 bytes)
    const amrMagic = new Uint8Array([0x23, 0x21, 0x41, 0x4d, 0x52, 0x0a]); // "#!AMR\n"
    const withHeader = new Uint8Array(amrMagic.length + audioPayload.length);
    withHeader.set(amrMagic);
    withHeader.set(audioPayload, amrMagic.length);
    audioPayload = withHeader;
    console.log(`[iflytekService] ✅ 添加 AMR-NB 魔数头后: ${audioPayload.length} bytes`);

    // ----- AMR 数据验证 -----
    const payloadSize = audioPayload.length;
    const estimatedSeconds = payloadSize / AMR_NB_BYTES_PER_SEC;
    console.log(`[iflytekService] 🎵 音频数据 (AMR): ${payloadSize} bytes (~${estimatedSeconds.toFixed(1)}秒)`);

    // ★ 进一步降低 AMR 数据量阈值：从 100 降到 50 bytes
    // AMR 帧约 32 bytes/帧 @ 20ms，50 bytes ≈ 1-2 帧 ≈ 20-40ms 音频
    // 让极短的发音也能被识别
    if (payloadSize < 50) {
      const errMsg = `AMR 数据量过低 (仅 ${payloadSize} bytes)`;
      console.error(`[iflytekService] ❌ ${errMsg}. 文件总大小: ${originalSize} bytes`);
      throw new Error(`AUDIO_DATA_TOO_SMALL: ${errMsg}. 文件总大小: ${originalSize} bytes`);
    }

    return audioPayload;

  } else {
    // ===== WAV / PCM 处理（iOS 及兜底） =====
    const isRiff = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
    const isWave = isRiff && (bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45);

    if (isWave) {
      console.log(`[iflytekService] ✅ 检测到标准 WAV 文件，剔除前 ${WAV_HEADER_SIZE} 字节 WAV 头 → raw PCM`);
      audioPayload = bytes.slice(WAV_HEADER_SIZE);
    } else if (isRiff) {
      console.log(`[iflytekService] ⚠️ RIFF 容器但非 WAVE，仍尝试剔除前 ${WAV_HEADER_SIZE} 字节`);
      audioPayload = bytes.slice(WAV_HEADER_SIZE);
    } else {
      console.log(`[iflytekService] ⚠️ 文件非 RIFF 格式 (magic: ${magicHex})，直接使用全部 ${originalSize} bytes`);
      audioPayload = bytes;
    }

    // PCM 数据验证
    const payloadSize = audioPayload.length;
    console.log(`[iflytekService] 🎵 音频数据 (raw PCM): ${payloadSize} bytes (${(payloadSize / 1024).toFixed(1)} KB)`);

    const estimatedSeconds = payloadSize / PCM_BYTES_PER_SEC;
    console.log(`[iflytekService] 📐 预估录音时长: ~${estimatedSeconds.toFixed(1)} 秒 (@ ${PCM_BYTES_PER_SEC} bytes/s)`);

    // ★ 进一步降低 PCM 数据量阈值：从 1024 降到 512 bytes
    // 512 bytes @ 16kHz 16bit mono ≈ 16ms 音频
    // 让极短的发音也能被识别
    if (payloadSize < 512) {
      const errMsg = `音频数据量过低 (仅 ${payloadSize} bytes, ~${(payloadSize / PCM_BYTES_PER_SEC * 1000).toFixed(0)}ms)。\n` +
        `可能原因：录音编码配置未生效，或用户未发声。\n` +
        `期望数据量：约 ${PCM_BYTES_PER_SEC} bytes/秒 (PCM 16kHz s16le)`;
      console.error(`[iflytekService] ❌ ${errMsg}`);
      throw new Error(`AUDIO_DATA_TOO_SMALL: ${errMsg}`);
    }

    if (payloadSize < PCM_BYTES_PER_SEC) {
      console.warn(`[iflytekService] ⚠️ 音频数据量偏低 (${payloadSize} bytes < ${PCM_BYTES_PER_SEC} bytes/秒预期)，录音可能无效`);
    }

    // ★ 关键修复：对 PCM 数据做数字增益放大
    // 远距离录音振幅小，讯飞 API 难以识别
    // 将振幅放大 3 倍（动态调整避免削波）
    audioPayload = amplifyPCM(audioPayload, 3.0);
    console.log(`[iflytekService] 🔊 PCM 增益后: ${audioPayload.length} bytes`);

    return audioPayload;
  }
}

// ========== 讯飞 ISE（语音评测）集成 ==========

import { getBusinessParams } from '../utils/xf_speech/businessParams';
import { generateXFUrl } from '../utils/xf_speech/index';
import { XFiseClient, type XFIseResult } from '../utils/xf_speech/xfiseClient';

/**
 * AMR 友好切片 — 将 AMR 位流分割为 Base64 编码的音频帧
 * 
 * 与 AudioStreamer.slice() 不同：
 * - 不填充末帧（AMR 帧大小可变，填充会破坏位流）
 * - 使用较小的标准帧大小（640 bytes ≈ 40ms @ AMR 12.2kbps）
 * 
 * 注意：status 字段仅用于内部记录，不直接映射 ISE API 的 status。
 *       XFiseClient 会统一设置 data.status=1（音频帧）和 data.status=2（结束帧）。
 */
function sliceAudioForISE(audioData: Uint8Array): Array<{ data: string }> {
  // ★ 关键修复：AMR 数据包含 magic 头（#!AMR\n，6 bytes），
  // 切片时应从 magic 头之后开始，避免第一帧包含非 AMR 帧数据
  // AMR magic 头: "#!AMR\n" = 6 bytes
  const AMR_MAGIC_SIZE = 6;
  const isAmr = audioData.length >= AMR_MAGIC_SIZE &&
    audioData[0] === 0x23 && audioData[1] === 0x21 &&
    audioData[2] === 0x41 && audioData[3] === 0x4d &&
    audioData[4] === 0x52 && audioData[5] === 0x0a;
  
  const dataStart = isAmr ? AMR_MAGIC_SIZE : 0;
  const effectiveLength = audioData.length - dataStart;
  
  // AMR 帧大小约 32 bytes/帧 @ 12.2kbps
  // 640 bytes ≈ 20 帧 ≈ 400ms 音频
  const CHUNK_SIZE = 640;
  const totalFrames = Math.ceil(effectiveLength / CHUNK_SIZE);
  const chunks: Array<{ data: string }> = [];

  for (let i = 0; i < totalFrames; i++) {
    const start = dataStart + i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, audioData.length);
    const frame = audioData.slice(start, end);

    // AMR: 不要填充末帧，直接使用剩余的数据
    let binary = '';
    for (let j = 0; j < frame.length; j++) {
      binary += String.fromCharCode(frame[j]);
    }
    const base64 = btoa(binary);

    chunks.push({
      data: base64,
    });
  }

  console.log(`[iflytekService] 🔪 音频切片: ${chunks.length} 帧 (总 ${audioData.length} bytes, 有效 ${effectiveLength} bytes, chunk=${CHUNK_SIZE}, isAmr=${isAmr})`);
  return chunks;
}

/**
 * 使用讯飞 ISE（语音评测）API 进行发音评分
 * 
 * 这是推荐的评测方式，与 IAT 不同：
 * - ISE 直接返回音素级准确性/流利度/完整度等维度分数
 * - 原生支持 AMR_NB 编码（适用于 Android 3GP 录音）
 * - 不需要本地 Levenshtein 距离计算
 * 
 * @param audioUri 录音文件的 URI
 * @param targetText 目标评测文本（如 "hello world"）
 * @returns 评测结果 { score, recognized, target, isSilent, detail? }
 */
export async function evaluateWithISE(
  audioUri: string,
  targetText: string
): Promise<{
  score: number;
  recognized: string;
  target: string;
  isSilent: boolean;
  detail?: XFIseResult;
}> {
  // 1. 读取音频文件
  let audioPayload: Uint8Array;
  try {
    audioPayload = await readAudioFile(audioUri);
  } catch (err: any) {
    console.error('[iflytekService] ❌ ISE 音频读取失败:', err.message);
    return { score: 0, recognized: '', target: targetText, isSilent: true };
  }

  // 2. 静音检测（★ 降低阈值：从 200 降到 100 bytes）
  if (audioPayload.length < 100) {
    console.warn('[iflytekService] ⚠️ ISE: 音频数据量过低，视为静音');
    return { score: 0, recognized: '', target: targetText, isSilent: true };
  }

  // 3. 根据文本类型确定题型和试题格式
  // 讯飞 ISE API 要求英文题型文本必须带标记：
  //   单词 (read_word):   "[word]\ntouchpad"
  //   句子 (read_sentence): "[content]\nThis is a sentence."
  //   见 API 文档：https://www.xfyun.cn/doc/Ise/Ise-API.html#英文句子（read_sentence）
  //
  // ⚠️ 重要：传给评测接口的文本必须经过 cleanTextForSpeech 处理，
  // 移除下划线等特殊符号，避免干扰评分准确性
  const cleanTarget = cleanTextForSpeech(targetText);
  const isSingleWord = cleanTarget.split(/\s+/).length <= 2 && !cleanTarget.includes(',') && !cleanTarget.includes('.');
  const category = isSingleWord ? 'read_word' : 'read_sentence';

  // 构建带标记的试题文本（API 严格要求的格式）
  let formattedText: string;
  if (category === 'read_word') {
    // 英文单词题型: [word]\n单词内容
    formattedText = `[word]\n${cleanTarget}`;
  } else {
    // 英文句子题型: [content]\n句子内容
    formattedText = `[content]\n${cleanTarget}`;
  }
  console.log(`[iflytekService] 📝 试题格式: category=${category}, formattedText="${formattedText}"`);

  // ⚠️ 关键修复：text 字段必须是 BOM + 纯文本字符串（参考 Java Demo 的 '\uFEFF'+text），
  // 不是 Base64 编码！API 文档示例中也直接使用纯文本字符串。
  //
  // API 文档要求：text = BOM(0xFEFF) + 试题文本
  // Java Demo: .add("text", '\uFEFF'+text)
  const textWithBOM = '\uFEFF' + formattedText;
  const { encoding, sampleRate, format } = getCurrentAudioEncoding();
  const businessParams = getBusinessParams(textWithBOM, {
    ent: 'en_vip',
    category,
    aue: encoding as any,
  });

  // 4. 切片音频
  const chunks = sliceAudioForISE(audioPayload);

  // 5. 生成 ISE 鉴权 URL（传入讯飞 ISE 凭证：XF_API_KEY / XF_API_SECRET）
  const iseApiKey = process.env.EXPO_PUBLIC_XF_API_KEY || process.env.XF_API_KEY || '';
  const iseApiSecret = process.env.EXPO_PUBLIC_XF_API_SECRET || process.env.XF_API_SECRET || '';
  const url = generateXFUrl(iseApiKey, iseApiSecret);
  console.log(`[iflytekService] 🔐 ISE 鉴权 URL 已生成 (apiKey=${iseApiKey.substring(0, 8)}...)`);

  // 6. 执行评测
  const client = new XFiseClient(url, IFLYTEK_APP_ID);
  let iseResult: XFIseResult;
  try {
    console.log(`[iflytekService] 🚀 开始 ISE 评测: chunks=${chunks.length}, audioPayload=${audioPayload.length}bytes, encoding=${encoding}, format=${format}, sampleRate=${sampleRate}`);
    iseResult = await client.evaluate(businessParams, chunks as any, {
      encoding: encoding as any,
      format,
      sampleRate,
    });
    console.log(`[iflytekService] ✅ ISE 评测成功返回: totalScore=${iseResult.totalScore}, isRejected=${iseResult.isRejected}, words=${iseResult.words?.length || 0}`);
    } catch (err: any) {
    console.error(`[iflytekService] ❌ ISE 评测失败: code=${err.code}, message=${err.message}`);

    // 如果 ISE 返回错误（如 10223 服务未激活、40007 音频解码失败），
    // 自动回退到 IAT 转写 + Levenshtein 评分
    //
    // IAT 已支持 AMR 自动检测 (aue=amr)，所以 AMR 录音也可 fallback
    const fallbackCodes = [10223, 40007, 10043, 10105, 10106];
    if (fallbackCodes.includes(err.code)) {
      console.warn(`[iflytekService] ⚠️ ISE 错误 code=${err.code}，尝试回退到 IAT`);
      if (err.code === 10223) {
        console.warn('[iflytekService] 💡 提示：请前往 https://console.xfyun.cn/services/ise 确认 ISE 服务已开通');
      }

      try {
        console.log(`[iflytekService] 🔄 开始 IAT fallback (audioUri=${audioUri.substring(0, 50)}..., targetText="${targetText}")`);
        const iatResult = await evaluateWithIflytek(audioUri, targetText);
        console.log(`[iflytekService] ℹ️ IAT fallback 结果: score=${iatResult.score}, recognized="${iatResult.recognized}", isSilent=${iatResult.isSilent}`);
        return {
          score: iatResult.score,
          recognized: iatResult.recognized,
          target: targetText,
          isSilent: iatResult.isSilent,
        };
      } catch (fallbackErr: any) {
        console.error(`[iflytekService] ❌ IAT fallback 也失败: ${fallbackErr.message}`);
        return { score: 0, recognized: '', target: targetText, isSilent: false };
      }
    }

    console.warn(`[iflytekService] ⚠️ ISE 错误 code=${err.code} 不在 fallback 列表中，返回空结果`);
    return { score: 0, recognized: '', target: targetText, isSilent: false };
  }

  // 7. 提取分数
  const score = iseResult.totalScore || iseResult.dimensions?.total_score || 0;
  const recognized = iseResult.words?.map(w => w.text).join(' ') || '';

  console.log(`[iflytekService] ✅ ISE 评测完成: score=${score}, words=${recognized}, isRejected=${iseResult.isRejected}`);

  // ===== 8. 结果有效性验证 =====
  // 即使 code=0，以下情况仍应触发 IAT fallback：
  //   a) isRejected === true（引擎拒绝评测）
  //   b) 全零分 + 无逐词数据（音频解码失败但未显式报错）
  //
  // 引擎拒绝通常是因为音频格式不兼容：
  //   - AMR 编码用 aue=raw 发送，引擎无法解码音频流
  //   - 用户未发音导致音频数据过短
  const isAllZeroScores = score === 0 && (!iseResult.words || iseResult.words.length === 0);
  const shouldFallback = iseResult.isRejected === true || isAllZeroScores;

  if (shouldFallback) {
    console.warn(`[iflytekService] ⚠️ ISE 结果无效 (isRejected=${iseResult.isRejected}, allZero=${isAllZeroScores}), 触发 IAT fallback`);

    try {
      const iatResult = await evaluateWithIflytek(audioUri, targetText);
      console.log(`[iflytekService] ℹ️ IAT fallback 结果: score=${iatResult.score}, recognized="${iatResult.recognized}"`);
      return {
        score: iatResult.score,
        recognized: iatResult.recognized,
        target: targetText,
        isSilent: iatResult.isSilent,
      };
    } catch (fallbackErr: any) {
      console.error('[iflytekService] ❌ IAT fallback 也失败:', fallbackErr.message);
      return { score: 0, recognized: '', target: targetText, isSilent: false };
    }
  }

  return {
    score: Math.round(score),
    recognized,
    target: targetText,
    isSilent: false,
    detail: iseResult,
  };
}

// ========== 讯飞 IAT 帧协议（仅支持 raw/speex/speex-wb） ==========

/**
 * 检测音频数据是否为 AMR 格式（AMR-NB magic: #!AMR, AMR-WB magic: #!AMR-WB）
 * 现在 Android 使用 AMR_WB，魔数为 "#!AMR-WB\n"（8 字节）
 */
function isAmrData(audioData: Uint8Array): boolean {
  // AMR-WB: "#!AMR-WB\n" (8 bytes)
  if (
    audioData.length >= 8 &&
    audioData[0] === 0x23 &&
    audioData[1] === 0x21 &&
    audioData[2] === 0x41 &&
    audioData[3] === 0x4d &&
    audioData[4] === 0x52 &&
    audioData[5] === 0x2d &&  // '-'
    audioData[6] === 0x57 &&  // 'W'
    audioData[7] === 0x42 &&  // 'B'
    audioData[8] === 0x0a     // '\n'
  ) {
    return true;
  }
  // AMR-NB: "#!AMR\n" (6 bytes) — 兼容旧文件
  return (
    audioData.length >= 6 &&
    audioData[0] === 0x23 &&
    audioData[1] === 0x21 &&
    audioData[2] === 0x41 &&
    audioData[3] === 0x4d &&
    audioData[4] === 0x52 &&
    audioData[5] === 0x0a
  );
}

/**
 * 检测 AMR 数据类型：AMR-WB 返回 'amr-wb', AMR-NB 返回 'amr', 否则返回 null
 */
function detectAmrType(audioData: Uint8Array): string | null {
  // AMR-WB: "#!AMR-WB\n" (9 bytes)
  if (
    audioData.length >= 9 &&
    audioData[0] === 0x23 &&
    audioData[1] === 0x21 &&
    audioData[2] === 0x41 &&
    audioData[3] === 0x4d &&
    audioData[4] === 0x52 &&
    audioData[5] === 0x2d &&  // '-'
    audioData[6] === 0x57 &&  // 'W'
    audioData[7] === 0x42 &&  // 'B'
    audioData[8] === 0x0a     // '\n'
  ) {
    return 'amr-wb';
  }
  // AMR-NB: "#!AMR\n" (6 bytes)
  if (
    audioData.length >= 6 &&
    audioData[0] === 0x23 &&
    audioData[1] === 0x21 &&
    audioData[2] === 0x41 &&
    audioData[3] === 0x4d &&
    audioData[4] === 0x52 &&
    audioData[5] === 0x0a
  ) {
    return 'amr';
  }
  return null;
}

function buildFirstFrame(encoding: string, sampleRate: number, format: string, audioPayload?: Uint8Array): Record<string, any> {
  // 检测音频数据实际格式
  const amrType = audioPayload ? detectAmrType(audioPayload) : null;
  const isAmr = amrType !== null;

  // IAT API 支持的编码：raw | speex | speex-wb | amr | amr-wb
  // AMR-WB 数据使用 aue=amr-wb，AMR-NB 数据使用 aue=amr
  const iatEncoding = isAmr ? amrType! :
    (encoding === 'amr-nb' || encoding === 'amr-wb') ? 'raw' : encoding;
  // AMR-WB 的采样率为 16000，AMR-NB 为 8000
  const amrSampleRate = amrType === 'amr-wb' ? 16000 : 8000;
  const iatFormat = isAmr ? `audio/AMR;rate=${amrSampleRate}` :
    (encoding === 'amr-nb' || encoding === 'amr-wb') ? `audio/L16;rate=${sampleRate}` : format;

  const business: Record<string, any> = {
    language: 'en_us',
    domain: 'iat',
    accent: 'mandarin',
    vad_eos: 3000,
    // 注意：不使用 dwa: 'wpgs'（增量模式）
    // 在 wpgs 模式下，status=2 只返回最后增量文本（如 "."），而非完整识别结果
    // 去掉 dwa 后，status=2 返回该段音频的完整文本
    ptt: 1,
    aue: iatEncoding,
    sample_rate: String(isAmr ? amrSampleRate : sampleRate),
  };
  return {
    common: {
      app_id: IFLYTEK_APP_ID,
    },
    business,
    data: {
      status: 0,
      format: iatFormat,
      encoding: iatEncoding,
      audio: '',
    },
  };
}

function buildContinueFrame(audioBase64: string, encoding: string, format: string, sampleRate: number, audioPayload?: Uint8Array): Record<string, any> {
  const amrType = audioPayload ? detectAmrType(audioPayload) : null;
  const isAmr = amrType !== null;
  const iatEncoding = isAmr ? amrType! :
    (encoding === 'amr-nb' || encoding === 'amr-wb') ? 'raw' : encoding;
  const amrSampleRate = amrType === 'amr-wb' ? 16000 : 8000;
  const iatFormat = isAmr ? `audio/AMR;rate=${amrSampleRate}` :
    (encoding === 'amr-nb' || encoding === 'amr-wb') ? `audio/L16;rate=${sampleRate}` : format;
  return {
    data: {
      status: 1,
      format: iatFormat,
      encoding: iatEncoding,
      audio: audioBase64,
    },
  };
}

function buildLastFrame(encoding: string, format: string, sampleRate: number, audioPayload?: Uint8Array): Record<string, any> {
  const amrType = audioPayload ? detectAmrType(audioPayload) : null;
  const isAmr = amrType !== null;
  const iatEncoding = isAmr ? amrType! :
    (encoding === 'amr-nb' || encoding === 'amr-wb') ? 'raw' : encoding;
  const amrSampleRate = amrType === 'amr-wb' ? 16000 : 8000;
  const iatFormat = isAmr ? `audio/AMR;rate=${amrSampleRate}` :
    (encoding === 'amr-nb' || encoding === 'amr-wb') ? `audio/L16;rate=${sampleRate}` : format;
  return {
    data: {
      status: 2,
      format: iatFormat,
      encoding: iatEncoding,
      audio: '',
    },
  };
}

// ========== IAT 听写主函数 ==========

export interface IatResult {
  text: string;
  isFinal: boolean;
  confidence: number;
}

export function transcribeWithIflytek(
  audioUri: string,
  onProgress?: (partialText: string) => void
): Promise<string> {
  // 动态获取当前平台的编码配置
  const { encoding, sampleRate, format } = getCurrentAudioEncoding();

  return new Promise(async (resolve, reject) => {
    if (!IFLYTEK_APP_ID || !IFLYTEK_API_KEY || !IFLYTEK_API_SECRET) {
      reject(new Error('讯飞 API 凭证未配置'));
      return;
    }

    let audioData: Uint8Array;

    try {
      audioData = await readAudioFile(audioUri);

      if (audioData.length === 0) {
        reject(new Error('EMPTY_AUDIO'));
        return;
      }
    } catch (err: any) {
      reject(new Error(`音频文件读取失败: ${err.message}`));
      return;
    }

    const url = buildIatAuthUrl();
    console.log(`[iflytekService] 建立 WebSocket 连接 (encoding=${encoding}, sampleRate=${sampleRate}, format=${format}, audioSize=${audioData.length}bytes)`);

    const ws = new WebSocket(url);
    let finalText = '';
    let partialText = '';
    let finished = false;

    const timeoutId = setTimeout(() => {
      if (!finished) {
        finished = true;
        ws.close();
        reject(new Error('讯飞语音识别超时'));
      }
    }, 15000);

    ws.onopen = () => {
      console.log('[iflytekService] WebSocket 已连接，开始发送音频帧');

      // Step 1: 发送首帧，传入 audioData 用于自动检测 AMR 格式
      const firstFrame = buildFirstFrame(encoding, sampleRate, format, audioData);
      ws.send(JSON.stringify(firstFrame));

      // Step 2: 分批发送音频数据
      // iOS PCM: 1280 bytes ≈ 40ms @ 16kHz; Android AMR: 640 bytes ≈ 40ms @ 12.2kbps
      const isAmr = isAmrData(audioData);
      
      // ★ 关键修复：AMR 数据包含 magic 头（#!AMR\n，6 bytes），
      // 切片时应从 magic 头之后开始，避免第一帧包含非 AMR 帧数据
      // AMR magic 头: "#!AMR\n" = 6 bytes
      const AMR_MAGIC_SIZE = 6;
      const effectiveDataStart = isAmr ? AMR_MAGIC_SIZE : 0;
      const effectiveDataLength = audioData.length - effectiveDataStart;
      
      // AMR 帧大小约为 32 bytes/帧 @ 12.2kbps
      // 使用 640 bytes ≈ 20 帧 ≈ 400ms 音频（确保整数帧边界）
      const CHUNK_SIZE = isAmr ? 640 : 1280;
      let offset = effectiveDataStart;

      console.log(`[iflytekService] 📐 AMR 切片配置: isAmr=${isAmr}, magicSize=${AMR_MAGIC_SIZE}, effectiveData=${effectiveDataLength}bytes, chunkSize=${CHUNK_SIZE}`);

      const sendNextChunk = () => {
        if (finished) return;

        const end = Math.min(offset + CHUNK_SIZE, audioData.length);
        const chunk = audioData.slice(offset, end);

        if (chunk.length > 0) {
          const base64 = base64Encode(chunk);

          if (offset === effectiveDataStart) {
            const headerHint = base64.substring(0, 50);
            console.log(`[iflytekService] 🔊 首帧 base64[0:50]=${headerHint} | chunkSize=${chunk.length}bytes | isAmr=${isAmr}`);
          }

          const frame = buildContinueFrame(base64, encoding, format, sampleRate, audioData);
          try {
            ws.send(JSON.stringify(frame));
          } catch {}
          offset = end;

          // 每 40ms 发送一帧
          setTimeout(sendNextChunk, 40);
        } else {
          console.log('[iflytekService] 音频数据发送完成，发送尾帧');
          const lastFrame = buildLastFrame(encoding, format, sampleRate, audioData);
          ws.send(JSON.stringify(lastFrame));
        }
      };

      setTimeout(sendNextChunk, 100);
    };

    ws.onmessage = (event) => {
      try {
        const result = JSON.parse(event.data as string);
        console.log(`[iflytekService] 📩 收到帧: code=${result.code} status=${result.data?.status}`);

        if (result.code !== 0) {
          console.error(`[iflytekService] ❌ 服务端错误: code=${result.code}, message=${result.message}`);
          if (!finished) {
            finished = true;
            clearTimeout(timeoutId);
            ws.close();
            reject(new Error(`讯飞错误 (${result.code}): ${result.message || '未知错误'}`));
          }
          return;
        }

        // 调试：打印收到的完整帧数据（截断）
        const debugFrame = JSON.stringify(result).substring(0, 500);
        console.log(`[iflytekService] 📩 完整帧: ${debugFrame}`);

        if (result.data?.result) {
          const wsData = result.data.result;
          let text = '';

          if (typeof wsData === 'object' && wsData.ws) {
            text = wsData.ws.map((w: any) =>
              (w.cw || []).map((cw: any) => cw.w || '').join('')
            ).join('');
          } else if (typeof wsData === 'string') {
            try {
              const parsed = JSON.parse(wsData);
              if (parsed.ws) {
                text = parsed.ws.map((w: any) =>
                  (w.cw || []).map((cw: any) => cw.w || '').join('')
                ).join('');
              }
            } catch {
              text = wsData;
            }
          }

          if (text) {
            console.log(`[iflytekService] 🎙 识别文本: "${text}" (status=${result.data.status})`);
            if (result.data.status === 2) {
              finalText = text;
            } else {
              partialText = text;
              if (onProgress) onProgress(partialText);
            }
          } else if (result.data.status === 2) {
            console.log('[iflytekService] ⚠️ status=2 但无识别文本（静音或无法解码）');
          }
        }

        if (result.data?.status === 2) {
          console.log('[iflytekService] ✅ 服务端确认处理完成');
          if (!finished) {
            finished = true;
            clearTimeout(timeoutId);
            ws.close();
            resolve(finalText || partialText || '');
          }
        }
      } catch (parseErr) {
        console.warn('[iflytekService] 消息解析失败:', parseErr);
      }
    };

    ws.onclose = (event) => {
      console.log(`[iflytekService] WebSocket 关闭: code=${event.code}, reason=${event.reason}`);
      if (!finished) {
        finished = true;
        clearTimeout(timeoutId);
        resolve(finalText || partialText || '');
      }
    };

    ws.onerror = (event) => {
      console.error('[iflytekService] WebSocket 错误:', event);
      if (!finished) {
        finished = true;
        clearTimeout(timeoutId);
        reject(new Error('讯飞 WebSocket 连接失败'));
      }
    };
  });
}

/**
 * 使用 IAT（语音转写）进行发音评估（旧方法）
 * 
 * 注意：此方法是 IAT + Levenshtein 距离的间接评分方式，
 * 推荐使用 evaluateWithISE() 获取更精准的评测结果。
 * 此函数保留作为 ISE 不可用时的回退。
 */
export async function evaluateWithIflytek(
  audioUri: string,
  targetText: string
): Promise<{
  score: number;
  recognized: string;
  target: string;
  isSilent: boolean;
}> {
  let recognized = '';

  try {
    recognized = await transcribeWithIflytek(audioUri);
  } catch (err: any) {
    console.error('[iflytekService] ❌ 转写失败:', err.message);

    if (err.message === 'EMPTY_AUDIO') {
      throw new Error('EMPTY_AUDIO');
    }

    return {
      score: 0,
      recognized: '',
      target: targetText,
      isSilent: false,
    } as any;
  }

  const cleanTargetIAT = cleanTextForSpeech(targetText);
  const cleaned = recognized.trim().toLowerCase().replace(/[.,!?;:'"(){}[\]«»-]/g, '').trim();
  if (!cleaned || cleaned.length < 1) {
    // IAT 返回空文本（静音或无法解码），不抛异常，直接返回 0 分
    console.warn('[iflytekService] ⚠️ IAT 识别结果为空，与是否为 EMPTY_AUDIO？返回 score=0');
    return {
      score: 0,
      recognized: '',
      target: targetText,
      isSilent: true,
    };
  }

  const score = levenshteinScore(recognized, cleanTargetIAT);

  return {
    score,
    recognized,
    target: targetText,
    isSilent: false,
  };
}
