/**
 * test_xf_ise.js — 讯飞语音评测 (ISE) 集成测试脚本
 *
 * 自包含脚本，使用 Node.js 22 原生 WebSocket + crypto-js。
 * 读取 .env 中的 EXPO_PUBLIC_XF_* 凭证（或 XF_*）。
 *
 * 用法：node scripts/test_xf_ise.js [pcm文件路径]
 *   如果未指定文件，则生成 2 秒 16kHz 16bit 静音 PCM（用于测试联通性）。
 *
 * 依赖：crypto-js（项目已安装）
 */

const path = require('path');
const fs = require('fs');
const CryptoJS = require('crypto-js');

// ========== 1. 读取 .env 配置 ==========

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) {
    console.error('❌ 未找到 .env 文件');
    process.exit(1);
  }
  const content = fs.readFileSync(envPath, 'utf-8');
  const env = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    env[key] = val;
  }
  return env;
}

const env = loadEnv();
const APP_ID = env.EXPO_PUBLIC_XF_APP_ID || env.XF_APP_ID || '';
const API_KEY = env.EXPO_PUBLIC_XF_API_KEY || env.XF_API_KEY || '';
const API_SECRET = env.EXPO_PUBLIC_XF_API_SECRET || env.XF_API_SECRET || '';

if (!APP_ID || !API_KEY || !API_SECRET) {
  console.error('❌ .env 中缺少讯飞凭证。请设置 EXPO_PUBLIC_XF_APP_ID / EXPO_PUBLIC_XF_API_KEY / EXPO_PUBLIC_XF_API_SECRET');
  process.exit(1);
}

console.log('✅ 讯飞凭证已加载 (app_id 前 8 位):', APP_ID.substring(0, 8) + '...');

// ========== 2. 鉴权 URL 生成 (generateXFUrl) ==========

function getRFC1123Date() {
  return new Date().toUTCString();
}

function generateXFUrl() {
  const host = 'ise-api.xfyun.cn';
  const pathStr = '/v2/open-ise';
  const date = getRFC1123Date();

  const signatureOrigin = `host: ${host}\ndate: ${date}\nGET ${pathStr} HTTP/1.1`;
  console.log('[test] 🔐 签名字符串:', JSON.stringify(signatureOrigin));

  const signatureWordArray = CryptoJS.HmacSHA256(signatureOrigin, API_SECRET);
  const signature = CryptoJS.enc.Base64.stringify(signatureWordArray);

  const authorizationRaw =
    `api_key="${API_KEY}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;

  const authorizationWordArray = CryptoJS.enc.Utf8.parse(authorizationRaw);
  const authorization = CryptoJS.enc.Base64.stringify(authorizationWordArray);

  const authParams =
    `host=${encodeURIComponent(host)}` +
    `&date=${encodeURIComponent(date)}` +
    `&authorization=${encodeURIComponent(authorization)}`;

  const url = `wss://${host}${pathStr}?${authParams}`;
  console.log('[test] ✅ 鉴权 URL 已生成');
  return url;
}

// ========== 3. 文本处理 (prepareXFText) ==========

function prepareXFText(text) {
  const BOM = [0xEF, 0xBB, 0xBF];
  const textBytes = new TextEncoder().encode(text);
  const combined = new Uint8Array(BOM.length + textBytes.length);
  combined.set(BOM, 0);
  combined.set(textBytes, BOM.length);
  let binary = '';
  combined.forEach((byte) => { binary += String.fromCharCode(byte); });
  const base64 = btoa(binary);
  console.log('[test] 📝 文本已编码:', { original: text, base64Length: base64.length });
  return base64;
}

// ========== 4. 业务参数 (getBusinessParams) ==========

const XF_PARAMS_DEFAULTS = {
  ent: 'en_vip',
  category: 'read_sentence',
  aue: 'raw',
  extra_ability: 'multi_dimension',
};

function getBusinessParams(textBase64, customConfig) {
  const merged = { ...XF_PARAMS_DEFAULTS, text: textBase64, ...customConfig };
  console.log('[test] 📦 业务参数:', {
    ent: merged.ent,
    category: merged.category,
    aue: merged.aue,
    extra_ability: merged.extra_ability,
    textLength: merged.text.length,
  });
  return merged;
}

// ========== 5. 音频切片 (AudioStreamer) ==========

const CHUNK_SIZE = 1280; // ~40ms @ 16kHz/16bit/mono

function sliceAudio(audioBytes) {
  const chunks = [];
  let offset = 0;
  while (offset < audioBytes.length) {
    const end = Math.min(offset + CHUNK_SIZE, audioBytes.length);
    const chunk = audioBytes.slice(offset, end);
    // Base64 编码
    let binary = '';
    for (let i = 0; i < chunk.length; i++) {
      binary += String.fromCharCode(chunk[i]);
    }
    chunks.push({
      status: 1,
      data: btoa(binary),
    });
    offset = end;
  }
  console.log(`[test] 🔪 音频切片: ${chunks.length} 帧 (总 ${audioBytes.length} 字节)`);
  return chunks;
}

// ========== 6. XFiseClient ==========

const RESPONSE_TIMEOUT_MS = 10000; // 测试时给 10 秒

function base64Decode(base64Str) {
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

function runEvaluation(url, appId, businessParams, audioChunks) {
  return new Promise((resolve, reject) => {
    console.log('[test] 🔗 连接 ISE 服务器...');

    const ws = new WebSocket(url);
    const resultBuffer = [];
    let finished = false;

    const responseTimer = setTimeout(() => {
      if (!finished) {
        finished = true;
        ws.close();
        reject(new Error('评测超时（10 秒内未收到响应）'));
      }
    }, RESPONSE_TIMEOUT_MS);

    ws.onopen = () => {
      console.log('[test] ✅ WebSocket 已连接，发送首帧 (status:0)');

      const firstFrame = {
        common: { app_id: appId },
        business: {
          ent: businessParams.ent,
          category: businessParams.category,
          aue: businessParams.aue,
          extra_ability: businessParams.extra_ability,
          text: businessParams.text,
        },
        data: {
          status: 0,
          format: 'audio/L16;rate=16000',
          encoding: 'raw',
          data: '',
        },
      };

      ws.send(JSON.stringify(firstFrame));
      console.log('[test] 📤 首帧已发送');

      // 发送音频切片
      let chunkIndex = 0;

      const sendNextChunk = () => {
        if (finished || ws.readyState !== WebSocket.OPEN) return;

        if (chunkIndex >= audioChunks.length) {
      console.log('[test] 📤 发送尾帧 (status:2)');
          const lastFrame = {
            data: {
              status: 2,
              format: 'audio/L16;rate=16000',
              encoding: 'raw',
              data: '',
            },
          };
          ws.send(JSON.stringify(lastFrame));
          return;
        }

        const chunk = audioChunks[chunkIndex];
        const continueFrame = {
          data: {
            status: 1,
            format: 'audio/L16;rate=16000',
            encoding: 'raw',
            data: chunk.data,
          },
        };

        ws.send(JSON.stringify(continueFrame));
        chunkIndex++;

        if (chunkIndex % 10 === 0) {
          console.log(`[test] 📤 已发送 ${chunkIndex}/${audioChunks.length} 帧`);
        }

        setTimeout(sendNextChunk, 40);
      };

      setTimeout(sendNextChunk, 100);
    };

    ws.onmessage = (event) => {
      try {
        const result = JSON.parse(event.data);

        console.log('[test] 📩 收到响应:', {
          code: result.code,
          status: result.data?.status,
          message: result.message,
          hasData: !!result.data?.data,
          dataLength: typeof result.data?.data === 'string' ? result.data.data.length : 0,
        });

        clearTimeout(responseTimer);

        if (result.code !== 0) {
          console.error(`[test] ❌ 服务器返回错误: code=${result.code}, message="${result.message}"`);
          finished = true;
          ws.close();
          reject(new Error(`讯飞错误 (${result.code}): ${result.message}`));
          return;
        }

        const rawData = result.data?.data;
        if (typeof rawData === 'string' && rawData.length > 0) {
          resultBuffer.push(rawData);
          console.log(`[test] 📥 缓存数据 (第 ${resultBuffer.length} 段): ${rawData.length} 字节`);
        }

        if (result.data?.status === 2) {
          finished = true;
          ws.close();

          console.log(`[test] ✅ 评测完成，共收到 ${resultBuffer.length} 段数据`);
          const combinedBase64 = resultBuffer.join('');
          const xmlString = base64Decode(combinedBase64);

          resolve({
            xml: xmlString,
            raw: result,
          });
        }
      } catch (parseErr) {
        console.warn('[test] ⚠️ 消息解析失败:', parseErr);
      }
    };

    ws.onerror = (event) => {
      console.error('[test] ❌ WebSocket 错误');
      if (!finished) {
        finished = true;
        ws.close();
        reject(new Error('WebSocket 连接失败'));
      }
    };

    ws.onclose = (event) => {
      console.log(`[test] 🔌 WebSocket 关闭: code=${event.code}`);
      if (!finished) {
        finished = true;
        reject(new Error(`WebSocket 意外关闭 (code: ${event.code})`));
      }
    };
  });
}

// ========== 7. 生成模拟 PCM 音频（2 秒 16kHz 16bit 单声道静音） ==========

function generateSilentPcm(durationMs) {
  const sampleRate = 16000;
  const numSamples = Math.floor(sampleRate * durationMs / 1000);
  const buffer = Buffer.alloc(numSamples * 2); // 16-bit = 2 bytes per sample
  // 全部为 0 = 静音
  console.log(`[test] 🔇 生成 ${durationMs}ms 静音 PCM: ${buffer.length} 字节 (${numSamples} 采样点)`);
  return new Uint8Array(buffer);
}

// ========== 8. 主流程 ==========

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  讯飞语音评测 (ISE) 集成测试');
  console.log('═══════════════════════════════════════════\n');

  // 读取或生成 PCM 音频
  const pcmPath = process.argv[2];
  let audioBytes;

  if (pcmPath) {
    console.log(`[test] 📂 读取 PCM 文件: ${pcmPath}`);
    audioBytes = new Uint8Array(fs.readFileSync(pcmPath));
    console.log(`[test] 📂 文件大小: ${audioBytes.length} 字节`);
  } else {
    console.log('[test] 🔇 未指定文件，使用 2 秒静音 PCM');
    audioBytes = generateSilentPcm(2000);
  }

  // 1. 生成鉴权 URL
  const url = generateXFUrl();

  // 2. 准备文本
  const textB64 = prepareXFText('Hello world');

  // 3. 业务参数
  const bizParams = getBusinessParams(textB64, {
    ent: 'en_vip',
    category: 'read_sentence',
  });

  // 4. 音频切片
  const chunks = sliceAudio(audioBytes);

  // 5. 执行评测
  console.log('\n[test] 🚀 开始评测流程...\n');

  try {
    const result = await runEvaluation(url, APP_ID, bizParams, chunks);

    console.log('\n═══════════════════════════════════════════');
    console.log('  ✅ 测试成功');
    console.log('═══════════════════════════════════════════\n');
    console.log('📄 原始 XML 结果:\n');
    console.log(result.xml || '(空)');
    console.log('\n───────────────────────────────────────────\n');
    console.log('📊 服务端原始 JSON (截取前 800 字符):');
    console.log(JSON.stringify(result.raw, null, 2).substring(0, 800));

    // 简单解析 XML 中的分数
    extractScoresFromXml(result.xml);

  } catch (err) {
    console.error('\n═══════════════════════════════════════════');
    console.error('  ❌ 测试失败');
    console.error('═══════════════════════════════════════════\n');
    console.error('错误详情:', err.message);
    process.exit(1);
  }
}

function extractScoresFromXml(xml) {
  if (!xml) return;
  console.log('\n───────────────────────────────────────────\n');
  console.log('📊 XML 分数解析:');

  const extract = (tag) => {
    const match = xml.match(new RegExp(`<${tag}>(.+?)</${tag}>`));
    if (match) {
      const num = parseFloat(match[1]);
      return isNaN(num) ? null : num;
    }
    return null;
  };

  const total = extract('total_score');
  const accuracy = extract('accuracy_score');
  const fluency = extract('fluency_score');
  const integrity = extract('integrity_score');

  console.log(`  total_score      : ${total !== null ? total : '(未找到)'}`);
  console.log(`  accuracy_score   : ${accuracy !== null ? accuracy : '(未找到)'}`);
  console.log(`  fluency_score    : ${fluency !== null ? fluency : '(未找到)'}`);
  console.log(`  integrity_score  : ${integrity !== null ? integrity : '(未找到)'}`);

  // 尝试显示更多 XML 结构（发音详情）
  const wordMatches = xml.match(/<word[^>]*>.*?<\/word>/gs);
  if (wordMatches) {
    console.log(`\n  📝 单词级别数: ${wordMatches.length}`);
    wordMatches.slice(0, 3).forEach((w, i) => {
      console.log(`    [${i + 1}] ${w.substring(0, 200)}`);
    });
  }
}

main();
