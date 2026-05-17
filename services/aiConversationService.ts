/**
 * aiConversationService — AI 实时口语对话服务 (Step 2 & 3)
 *
 * 功能：
 * 1. STT（语音转文字）：优先调用腾讯云 ASR SentenceRecognition，失败时回退到讯飞 IAT
 * 2. LLM（大模型对话）：调用智谱 GLM-4-Flash（免费模型，OpenAI 兼容格式），
 *    使用专属 System Prompt 实现中英混说智能纠错
 *
 * 依赖：
 * - tencentAsrService.ts: transcribeWithTencent (STT 主引擎)
 * - iflytekService.ts: transcribeWithIflytek (STT 回退引擎)
 * - 环境变量：EXPO_PUBLIC_ZHIPU_API_KEY
 *
 * 环境变量说明（需在 .env 中配置）：
 * - EXPO_PUBLIC_TENCENT_SECRET_ID / TENCENT_SECRET_ID: 腾讯云 API 密钥 ID
 * - EXPO_PUBLIC_TENCENT_SECRET_KEY / TENCENT_SECRET_KEY: 腾讯云 API 密钥 Key
 * - EXPO_PUBLIC_XF_APP_ID / XF_APP_ID: 讯飞 APP ID（回退用）
 * - EXPO_PUBLIC_XF_API_KEY / XF_API_KEY: 讯飞 API Key（回退用）
 * - EXPO_PUBLIC_XF_API_SECRET / XF_API_SECRET: 讯飞 API Secret（回退用）
 * - EXPO_PUBLIC_ZHIPU_API_KEY: 智谱 AI API Key（用于 GLM-4-Flash 对话）
 */

import { transcribeWithIflytek } from './iflytekService';
import { transcribeWithTencent } from './tencentAsrService';

// ====== 智谱 GLM-4-Flash 配置（免费模型） ======
const ZHIPU_API_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
// 优先从 process.env 读取（Expo 编译注入），兜底使用硬编码值（确保运行时可用）
const ZHIPU_API_KEY = process.env.EXPO_PUBLIC_ZHIPU_API_KEY || 'f70c822d62bb4fa488e6cf93401a1ed6.MM9sPamtfzmwXDHv';
const ZHIPU_MODEL_NAME = 'GLM-4-Flash';
const LLM_TIMEOUT_MS = 30000;

// ====== 对话历史管理 ======
export interface ConversationMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// ====== System Prompt（英语口语陪练 + 中英混说教学） ======
// 设计原则：简短、自然、聚焦对话。当用户混用中文时，AI 识别中文并教英文表达。
const SYSTEM_PROMPT = `You are a friendly English conversation partner for the app "LensGo". Your job is to have a natural conversation AND help the user learn English expressions.

RULES:
1. Listen carefully to what the user says and respond NATURALLY — like a real person, not a teacher.
2. Keep your reply SHORT: 1-2 sentences max. This is a voice call, not a text chat.
3. If the user says something in Chinese (a word or phrase they don't know in English), do the following:
   a. First, acknowledge what they said and respond naturally to their message.
   b. Then, teach them the English equivalent: "In English, you can say: [English expression]."
   c. Keep the teaching part brief — just one short sentence.
4. Never repeat the same phrase. Vary your responses naturally.
5. Ask follow-up questions to keep the conversation going.

Examples:
User: "The living room looks nice, but we need a 地毯."
AI: "Oh, a rug would really tie the room together! In English, you can say 'rug' or 'carpet'. What color are you thinking?"

User: "I want to 预约 a table for dinner."
AI: "Great idea! In English, you can say 'reserve' or 'book' a table. How many people are coming?"

User: "This 风景 is so beautiful."
AI: "It really is! In English, you can say 'scenery' or 'view'. Are you traveling somewhere nice?"`;

// ====== 构建 LLM 请求消息列表 ======
function buildMessages(
  userText: string,
  history: ConversationMessage[]
): ConversationMessage[] {
  // 始终以 System Prompt 开头
  const messages: ConversationMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
  ];

  // 追加对话历史（最多保留最近 10 轮，避免超出 token 限制）
  const recentHistory = history.slice(-10);
  messages.push(...recentHistory);

  // 追加当前用户输入
  messages.push({ role: 'user', content: userText });

  return messages;
}

// ====== 调用智谱 GLM-4-Flash API 获取 AI 回复（免费模型） ======
export async function getAiReply(
  userText: string,
  history: ConversationMessage[]
): Promise<string> {
  const apiKey = ZHIPU_API_KEY;

  if (!apiKey) {
    console.warn('[aiConversationService] 智谱 API Key 未配置，使用模拟回复');
    return getFallbackReply(userText);
  }

  const messages = buildMessages(userText, history);

  // 调试日志：打印发送给 LLM 的消息（方便排查问题）
  console.log('[aiConversationService] 📤 发送给 LLM 的消息:');
  messages.forEach((m, i) => {
    const preview = m.content.length > 80 ? m.content.substring(0, 80) + '...' : m.content;
    console.log(`  [${i}] ${m.role}: ${preview}`);
  });

  const requestBody = {
    model: ZHIPU_MODEL_NAME,
    messages,
    max_tokens: 256,        // 限制回复长度，避免冗长
    temperature: 0.9,       // 提高温度，增加回复多样性
    stream: false,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    const response = await fetch(ZHIPU_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      console.error(
        `[aiConversationService] 智谱 API 请求失败 (${response.status}): ${errorBody || response.statusText}`
      );
      return getFallbackReply(userText);
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content;

    if (!content) {
      console.warn('[aiConversationService] 智谱 API 返回内容为空');
      return getFallbackReply(userText);
    }

    console.log('[aiConversationService] ✅ LLM 原始回复:', content);
    return content.trim();
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      console.warn('[aiConversationService] 智谱请求超时');
    } else {
      console.error('[aiConversationService] 智谱请求失败:', error.message);
    }
    return getFallbackReply(userText);
  }
}

// ====== 兜底回复（API 不可用时） ======
function getFallbackReply(userText: string): string {
  // 检测用户输入中是否包含中文
  const hasChinese = /[\u4e00-\u9fff]/.test(userText);

  if (hasChinese) {
    // 提取中文部分
    const chineseParts = userText.match(/[\u4e00-\u9fff]+/g) || [];
    const chineseWords = [...new Set(chineseParts)].join('、');

    return `That's an interesting mix! I can understand what you're saying.
👉 你刚才用了"${chineseWords}"，试试用英文表达会更棒！如果你不确定，可以问我："How do you say ${chineseWords} in English?"`;
  }

  return "That's great! Keep practicing and you'll improve quickly. What else would you like to talk about?";
}

// ====== STT：语音转文字（腾讯云 ASR + 讯飞 IAT 回退） ======
/**
 * 将音频文件转写为文本
 *
 * 策略：
 * 1. 优先调用腾讯云 ASR（SentenceRecognition）
 * 2. 如果腾讯云未配置或失败，自动回退到讯飞 IAT（WebSocket 流式听写）
 *
 * @param audioUri 音频文件 URI
 * @returns 转写后的文本
 */
export async function transcribeAudio(audioUri: string): Promise<string> {
  // ---- 策略 1：腾讯云 ASR ----
  try {
    console.log('[aiConversationService] 🎤 尝试腾讯云 ASR:', audioUri);

    const transcribedText = await transcribeWithTencent(audioUri);

    if (transcribedText && transcribedText.trim().length > 0) {
      console.log('[aiConversationService] ✅ 腾讯云 ASR 转写结果:', transcribedText);
      return transcribedText.trim();
    }

    console.warn('[aiConversationService] ⚠️ 腾讯云 ASR 转写结果为空');
  } catch (error: any) {
    console.warn('[aiConversationService] ⚠️ 腾讯云 ASR 失败:', error.message);

    // 空音频不重试
    if (error.message === 'EMPTY_AUDIO') {
      return '';
    }
  }

  // ---- 策略 2：回退到讯飞 IAT ----
  try {
    console.log('[aiConversationService] 🎤 回退到讯飞 IAT:', audioUri);

    const iflytekText = await transcribeWithIflytek(audioUri);

    if (iflytekText && iflytekText.trim().length > 0) {
      console.log('[aiConversationService] ✅ 讯飞 IAT 转写结果:', iflytekText);
      return iflytekText.trim();
    }

    console.warn('[aiConversationService] ⚠️ 讯飞 IAT 转写结果为空');
    return '';
  } catch (fallbackError: any) {
    console.error('[aiConversationService] ❌ 讯飞 IAT 也失败:', fallbackError.message);

    if (fallbackError.message === 'EMPTY_AUDIO') {
      return '';
    }

    return '';
  }
}
