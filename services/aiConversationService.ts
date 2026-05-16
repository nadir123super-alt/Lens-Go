/**
 * aiConversationService — AI 实时口语对话服务 (Step 2 & 3)
 *
 * 功能：
 * 1. STT（语音转文字）：调用腾讯云 ASR SentenceRecognition 将音频文件转写为文本
 * 2. LLM（大模型对话）：调用硅基流动 Qwen2.5-72B-Instruct（OpenAI 兼容格式），
 *    使用专属 System Prompt 实现中英混说智能纠错
 *
 * 依赖：
 * - tencentAsrService.ts: transcribeWithTencent (STT)
 * - 环境变量：LLM_API_KEY, LLM_BASE_URL, LLM_MODEL_NAME
 *
 * 环境变量说明（需在 .env 中配置）：
 * - TENCENT_SECRET_ID: 腾讯云 API 密钥 ID
 * - TENCENT_SECRET_KEY: 腾讯云 API 密钥 Key
 * - LLM_API_KEY: 硅基流动 API Key
 * - LLM_BASE_URL: 硅基流动 API 地址 (https://api.siliconflow.cn/v1)
 * - LLM_MODEL_NAME: 模型名称 (Qwen/Qwen2.5-72B-Instruct)
 */

import { transcribeWithTencent } from './tencentAsrService';

// ====== 硅基流动 LLM 配置 ======
const LLM_BASE_URL = process.env.EXPO_PUBLIC_LLM_BASE_URL || process.env.LLM_BASE_URL || 'https://api.siliconflow.cn/v1';
const LLM_API_KEY = process.env.EXPO_PUBLIC_LLM_API_KEY || process.env.LLM_API_KEY || '';
const LLM_MODEL_NAME = process.env.EXPO_PUBLIC_LLM_MODEL_NAME || process.env.LLM_MODEL_NAME || 'Qwen/Qwen2.5-72B-Instruct';
const LLM_TIMEOUT_MS = 30000;

// ====== 对话历史管理 ======
export interface ConversationMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// ====== System Prompt（英语教练 + 中英混说纠错） ======
const SYSTEM_PROMPT = `You are a warm, patient, and professional English coach for the app "LensGo". Your goal is to help the user practice spoken English in a relaxed manner.

CRITICAL RULES FOR YOUR RESPONSES:
1. ALWAYS respond in natural, idiomatic, and conversational English as the main body of your reply. Keep your speech engaging and conversational.
2. LANGUAGE DETECTION & CORRECTION: 
   - Monitor the user's input closely. If the user uses ANY Chinese words or sentences (or mixes Chinese and English), you must understand it perfectly.
   - At the VERY END of your response, add a gentle, distinct correction note in Chinese. 
   - The note must explicitly tell the user how to say the Chinese part they used in natural English, providing a better alternative or translation.
3. FORMAT: Keep your English reply concise (1-3 sentences) so it's easy to listen to. Separated from your correction note by a new line.

Example Scenario:
User: "The living room looks nice, but we need a 地毯."
AI Response: "I agree! A nice living room always feels warmer with the right home decor. 
💡 英语小贴士：你刚才提到了"地毯"，在英语中我们通常说 'rug'（特别指小地毯/块毯）或者 'carpet'（铺满房间的大地毯）。你可以试着说：'We need a rug.'"`;

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

// ====== 调用硅基流动 LLM API 获取 AI 回复 ======
export async function getAiReply(
  userText: string,
  history: ConversationMessage[]
): Promise<string> {
  const apiKey = LLM_API_KEY;
  const baseUrl = LLM_BASE_URL.replace(/\/+$/, ''); // 去除末尾斜杠
  const modelName = LLM_MODEL_NAME;

  if (!apiKey || apiKey === 'your-llm-api-key-here') {
    console.warn('[aiConversationService] LLM API Key 未配置，使用模拟回复');
    return getFallbackReply(userText);
  }

  const messages = buildMessages(userText, history);

  const requestBody = {
    model: modelName,
    messages,
    max_tokens: 1024,
    temperature: 0.7,
    stream: false,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
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
        `[aiConversationService] 硅基流动 API 请求失败 (${response.status}): ${errorBody || response.statusText}`
      );
      return getFallbackReply(userText);
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content;

    if (!content) {
      console.warn('[aiConversationService] 硅基流动 API 返回内容为空');
      return getFallbackReply(userText);
    }

    return content.trim();
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      console.warn('[aiConversationService] 硅基流动请求超时');
    } else {
      console.error('[aiConversationService] 硅基流动请求失败:', error.message);
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
💡 英语小贴士：你刚才使用了中文词汇"${chineseWords}"。在英语对话中，建议尝试用英文表达。如果你不确定某个词的英文说法，可以这样说："How do you say ${chineseWords} in English?" 这样我就能帮你了！`;
  }

  return "That's great! Keep practicing and you'll improve quickly. What else would you like to talk about?";
}

// ====== STT：语音转文字（腾讯云 ASR） ======
/**
 * 将音频文件发送到腾讯云 ASR 转写为文本
 * @param audioUri 音频文件 URI
 * @returns 转写后的文本
 */
export async function transcribeAudio(audioUri: string): Promise<string> {
  try {
    console.log('[aiConversationService] 🎤 开始语音转写（腾讯云 ASR）:', audioUri);

    // 调用腾讯云 ASR 进行语音转写
    const transcribedText = await transcribeWithTencent(audioUri);

    console.log('[aiConversationService] ✅ 转写结果:', transcribedText);

    if (!transcribedText || transcribedText.trim().length === 0) {
      console.warn('[aiConversationService] ⚠️ 转写结果为空');
      return '';
    }

    return transcribedText.trim();
  } catch (error: any) {
    console.error('[aiConversationService] ❌ 语音转写失败:', error.message);

    // 如果是空音频错误，返回空字符串
    if (error.message === 'EMPTY_AUDIO') {
      return '';
    }

    // 其他错误也返回空，让上层决定如何处理
    return '';
  }
}
