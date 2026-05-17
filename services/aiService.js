import * as FileSystem from 'expo-file-system/legacy';

const ZHIPU_API_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const DEEPSEEK_API_KEY = process.env.EXPO_PUBLIC_DEEPSEEK_API_KEY || '';
const TIMEOUT_MS = 60000;

/**
 * 将图片文件转换为 Base64 编码字符串
 * @param {string} imageUri - 图片文件路径（如 file:///...）
 * @returns {Promise<string>} Base64 编码的图片数据
 */
async function imageToBase64(imageUri) {
  try {
    const base64 = await FileSystem.readAsStringAsync(imageUri, {
      encoding: 'base64',
    });
    return base64;
  } catch (error) {
    throw new Error(`图片转 Base64 失败: ${error.message}`);
  }
}

/**
 * 提取字符串中第一个 { 到最后一个 } 之间的内容
 * 如果最后一个字符不是 }，尝试手动闭合 JSON
 * @param {string} text - 原始返回文本
 * @returns {string} 提取出的 JSON 字符串
 */
function extractJsonFromText(text) {
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error(`未在返回内容中找到有效的 JSON 对象: ${text.substring(0, 200)}`);
  }
  return text.substring(firstBrace, lastBrace + 1);
}

/**
 * 检查 JSON 字符串是否完整（以 } 结尾）
 * @param {string} jsonString - 要检查的 JSON 字符串
 * @returns {boolean} 是否完整
 */
function isJsonComplete(jsonString) {
  return jsonString.trim().endsWith('}');
}

/**
 * 尝试手动修复不完整的 JSON 字符串
 * 如果末尾缺少 ] }，尝试补齐
 * @param {string} jsonString - 可能不完整的 JSON 字符串
 * @returns {string} 修复后的 JSON 字符串
 */
function repairJsonString(jsonString) {
  let repaired = jsonString.trim();

  // 如果以 "}]" 结尾但缺少最后的 }
  if (repaired.endsWith(']') && !repaired.endsWith(']}')) {
    repaired = repaired + '}';
  }

  // 如果 objects 数组被截断，尝试闭合
  if (!repaired.endsWith(']}')) {
    // 尝试找到最后一个完整的对象 ] 并补全
    const lastCompleteObjMatch = repaired.match(/^[\s\S]*?\}\s*\]/);
    if (lastCompleteObjMatch) {
      repaired = lastCompleteObjMatch[0] + '}';
    }
  }

  // 如果还没有最后的 }，加上
  if (!repaired.endsWith('}')) {
    repaired = repaired + '}';
  }

  return repaired;
}

/**
 * 安全解析 JSON，包含容错和自动修复
 * @param {string} jsonString - 要解析的 JSON 字符串
 * @returns {Object} 解析后的对象
 */
function safeParseJson(jsonString) {
  // 检查数据完整性
  if (!isJsonComplete(jsonString)) {
    console.warn('⚠️ 数据不完整：JSON 字符串不是以 } 结尾，可能被截断');
    console.warn(`字符串长度: ${jsonString.length}，结尾: ${jsonString.slice(-50)}`);
  }

  try {
    return JSON.parse(jsonString);
  } catch (parseError) {
    // 尝试手动修复后重新解析
    const repaired = repairJsonString(jsonString);
    console.warn('⚠️ 尝试手动修复 JSON 后重新解析');
    console.warn(`修复后: ${repaired.slice(-80)}`);
    try {
      return JSON.parse(repaired);
    } catch {
      // 修复后仍然失败，尝试在 } 处截断
      const trimmedMatch = repaired.match(/^[\s\S]*?\}(?=\s*$)/);
      if (trimmedMatch) {
        try {
          const trimmed = trimmedMatch[0];
          console.warn('⚠️ 尝试在 } 处截断后重新解析');
          return JSON.parse(trimmed);
        } catch {
          // 仍然失败
        }
      }
    }
    throw parseError;
  }
}

/**
 * 分析裁剪后的局部图片，精准识别单个物体
 * 强制返回固定 JSON 格式：{ word, translation, examples: [{ en, cn }] }
 * @param {string} croppedBase64 - 裁剪后的局部小图（Base64 字符串）
 * @returns {Promise<{word: string, translation: string, examples: Array<{en: string, cn: string}>}>}
 */
export async function analyzeCroppedPatch(croppedBase64, apiKey) {
  if (!croppedBase64) {
    throw new Error('请提供裁剪后的图片 Base64 数据');
  }

  const messages = [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text:
            '你是一个专业的英语老师。针对这张图片中的物体，请：\n' +
            '1. 给出最精准的英文单词\n' +
            '2. 中文翻译\n' +
            '3. 针对该物体生成 2 句自然、地道、多样化的英语口语例句。\n' +
            '⚠️ 重要：严禁使用 "I see a..."、"I found a..." 这样的简单句式。例句必须是真实场景对话，如询问、描述、感叹、建议等不同语气。\n' +
            '⚠️ 关键约束：每个 en 字段必须且只能包含一个完整的英语句子。严禁将两个或多个句子合并到一个 en 字段中，只能有一个句号或感叹号或问号。\n' +
            '⚠️ 每个 cn 字段也必须且只能包含一个完整的中文句子，只能有一个句号或感叹号或问号。\n' +
            '你必须且只能返回如下固定 JSON 格式（不要任何 Markdown 标记或额外文字）：\n' +
            '{"word":"lamp","translation":"台灯","examples":[{"en":"Could you turn on the lamp?","cn":"你能把台灯打开吗？"},{"en":"This lamp gives such a warm and cozy glow.","cn":"这盏灯发出温暖舒适的光。"}]}\n' +
            '请确保 JSON 结构完整，必须以 } 结尾。\n' +
            '如果 AI 无法生成完整内容，宁可不返回结果，也不要使用 "I see a" 这类模板例句。',
        },
        {
          type: 'image_url',
          image_url: {
            url: `data:image/jpeg;base64,${croppedBase64}`,
          },
        },
      ],
    },
  ];

  const requestBody = {
    model: 'glm-4.6v',
    messages: messages,
    max_tokens: 2048,
    temperature: 0.3,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  let response;
  try {
    response = await fetch(ZHIPU_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
  } catch (fetchError) {
    clearTimeout(timeoutId);
    if (fetchError.name === 'AbortError') {
      throw new Error('TIMEOUT:裁剪图片 AI 请求超时（30 秒），请重试。');
    }
    throw new Error(`网络请求失败: ${fetchError.message}`);
  }
  clearTimeout(timeoutId);

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`请求失败 (${response.status}): ${errorBody || response.statusText}`);
  }

  const result = await response.json();
  const content = result.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('API 返回内容为空');
  }

  const jsonString = extractJsonFromText(content);

   try {
    const parsed = safeParseJson(jsonString);
    // 兼容新旧格式：优先解析 word/translation/examples，兼容 l/t/phrases
    if (parsed.word && parsed.translation && Array.isArray(parsed.examples)) {
      return { word: parsed.word, translation: parsed.translation, examples: parsed.examples };
    }
    // 兼容旧格式老数据
    if (parsed.l && parsed.t && Array.isArray(parsed.phrases)) {
      const oldExamples = parsed.phrases.map((p) => ({ en: p.e, cn: p.c }));
      return { word: parsed.l, translation: parsed.t, examples: oldExamples };
    }
    throw new Error('返回数据缺少必要字段（word + translation + examples 或 l + t + phrases）');
  } catch (parseError) {
    console.error('=== 裁剪识别返回原始内容 ===');
    console.error(content);
    console.error('=== 提取的 JSON 字符串 ===');
    console.error(jsonString);
    throw new Error(`解析裁剪识别结果失败: ${parseError.message}`);
  }
}

/**
 * 分析图片中的物体，调用智谱 AI (glm-4.6v) 返回结构化的识别结果
 * @param {string} imageUri - 本地图片文件 URI
 * @param {string} apiKey - 智谱 AI API 密钥
 * @returns {Promise<Object>} 识别结果，格式为 { intro, objects }
 *
 * 返回数据结构（精简版，无例句）：
 * {
 *   intro: "一句地道的英文开场白",
 *   objects: [
 *     {
 *       l: "英文名",       // label 缩写
 *       t: "中文名",       // translation 缩写
 *       x: 50,            // 数字类型，0-100 百分比
 *       y: 30,            // 数字类型，0-100 百分比
 *       size: "L"         // "L" 大物体 | "S" 小物体
 *     }
 *   ]
 * }
 */
export async function analyzeImage(imageUri, apiKey) {
  if (!imageUri) {
    throw new Error('请提供图片 URI');
  }
  if (!apiKey) {
    throw new Error('请提供智谱 AI API 密钥');
  }

  // 1. 将图片转为 Base64
  const base64Image = await imageToBase64(imageUri);

  // 2. 构造消息内容（更灵活的 Prompt，不硬性要求数量）
  const messages = [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text:
            '你是一个精细的视觉分析专家。请深度扫描图片，尽可能多地识别出可见的物体（最多 10 个，最少可以是 0 个）。\n' +
            '除了大型物体，请务必识别细小物品和局部细节，例如：插头、线缆、书脊、键盘上的按键区域、瓶盖、屏幕上的图标、甚至是墙上的开关。\n' +
            '尽可能分散地寻找物体，不要只挤在图片中心，要覆盖到图片的边缘区域。\n' +
            '请重新校准坐标系。x 和 y 必须是你识别到的物体在图片中的几何物理中心，严禁胡乱分布坐标。所有物体的 x, y 坐标必须严格对应其几何中心，确保锚点能精准落在物体正上方，误差不要超过 2%。\n' +
            '为了节省空间，字段名使用极简缩写：\n' +
            '  l = 物体英文名（label）\n' +
            '  t = 物体中文名（translation）\n' +
            '  x = 百分比坐标（数字类型，不要带引号）\n' +
            '  y = 百分比坐标（数字类型，不要带引号）\n' +
            '  size = 大物体返回 "L"（large），小物体返回 "S"（small）\n' +
            '暂时不要生成例句，只返回物体名称和坐标。\n' +
            'intro 字段必须且只能使用英文，一句自然的英文寒暄开场白。\n' +
            '如果图片中没有可见物体或识别不到任何物体，请返回空的 objects 数组。\n' +
            '必须且只能返回 JSON，结构如下（不要包含任何 Markdown 标记或额外解释）：\n' +
            '{"intro":"英文开场白","objects":[{"l":"lamp","t":"台灯","x":50,"y":30,"size":"L"}]}\n' +
            '请确保 JSON 结构完整，必须以 } 结尾。',

        },
        {
          type: 'image_url',
          image_url: {
            url: `data:image/jpeg;base64,${base64Image}`,
          },
        },
      ],
    },
  ];

  // 3. 构建请求体
  const requestBody = {
    model: 'glm-4.6v',
    messages: messages,
    max_tokens: 2048,
    temperature: 0.3,
  };

  // 4. 发送请求（带 60 秒超时）
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response;
  try {
    response = await fetch(ZHIPU_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
  } catch (fetchError) {
    clearTimeout(timeoutId);
    if (fetchError.name === 'AbortError') {
      throw new Error('TIMEOUT:智谱 AI API 请求超时（60 秒），请重试。');
    }
    throw new Error(`智谱 AI API 网络请求失败: ${fetchError.message}`);
  }
  clearTimeout(timeoutId);

  // 5. 处理响应
  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(
      `智谱 AI API 请求失败 (${response.status}): ${errorBody || response.statusText}`
    );
  }

  const result = await response.json();

  // 6. 解析返回的 JSON 内容
  const content = result.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('API 返回内容为空');
  }

  const jsonString = extractJsonFromText(content);

  try {
    const parsed = safeParseJson(jsonString);

    // 验证返回结构（更灵活）
    if (!parsed.intro || !Array.isArray(parsed.objects)) {
      throw new Error('返回数据格式不符合预期：缺少 intro 或 objects 字段');
    }

    // 确保 objects 中的每个对象都是有效的
    const validObjects = parsed.objects.filter(obj => {
      return obj && typeof obj.l === 'string' && typeof obj.t === 'string' &&
        typeof obj.x === 'number' && typeof obj.y === 'number' &&
        (obj.size === 'L' || obj.size === 'S');
    });

    // 返回有效的数据（即使 objects 为空也可以）
    return {
      intro: parsed.intro,
      objects: validObjects
    };
  } catch (parseError) {
    console.error('=== AI 返回的原始内容 ===');
    console.error(content);
    console.error('=== 提取的 JSON 字符串 ===');
    console.error(jsonString);
    console.error('=== 数据是否以 } 结尾 ===', isJsonComplete(jsonString));
    throw new Error(
      `AI 返回的数据无法解析为有效的 JSON。` +
      `\n原始内容长度: ${content.length} 字符` +
      `\n解析错误: ${parseError.message}`
    );
  }
}

import { fetchWordFromBank, upsertWordToBank } from './wordBankService';

/**
 * 获取单词的口语例句（带 Supabase 云端词库缓存机制）
 * 双轨制词库隔离逻辑：shared=拍照, search=查询
 * 
 * 三级检索逻辑：
 * 1. 查云端：向对应词库发起请求查询
 * 2. 命中缓存：如果查到数据，直接返回，禁止调用 AI
 * 3. AI 补偿：如果云端没有数据，调用 AI 生成，生成后存入对应词库
 * 
 * @param {string} label - 英文单词
 * @param {string} apiKey - 智谱 AI API 密钥
 * @param {boolean} [skipCache=false] - 是否跳过词库查询
 * @param {'search' | 'camera'} [source='search'] - 来源类型，决定使用哪个词库
 * @returns {Promise<Array<{e: string, c: string}>>} 例句数组
 */
export async function fetchPhrasesForObject(label, apiKey, skipCache = false, source = 'search', translation = null) {
  if (!label || !apiKey) {
    throw new Error('缺少必要参数 label 或 apiKey');
  }

  // 双轨制词库隔离：根据来源选择不同的词库
  const bankTableName = source === 'search' ? 'search_word_bank' : 'shared_word_bank';
  console.log(`📚 [fetchPhrasesForObject] 使用词库: ${bankTableName} (source: ${source})`);

  if (!skipCache) {
    const cachedData = await fetchWordFromBank(label, bankTableName);
    if (cachedData && cachedData.example_en_1 && cachedData.example_cn_1) {
      console.log(`✅ 从云端词库 ${bankTableName} 获取单词 "${label}" 的例句`);
      const phrases = [{ e: cachedData.example_en_1, c: cachedData.example_cn_1 }];
      if (cachedData.example_en_2 && cachedData.example_cn_2) {
        phrases.push({ e: cachedData.example_en_2, c: cachedData.example_cn_2 });
      }
      return phrases;
    }
  }

  // AI 生成例句，带重试机制（最多重试 3 次）
  const maxRetries = 3;
  let lastError = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const phrases = await generatePhrasesWithAI(label, apiKey);
      
      // AI 生成成功后，异步存入对应词库
      if (!skipCache && phrases.length >= 2) {
        // 使用传入的 translation（如果有），否则用 null
        upsertWordToBank(
          label,
          translation,
          phrases[0].e,
          phrases[0].c,
          phrases[1].e,
          phrases[1].c,
          bankTableName
        ).catch(() => {});
      }
      
      return phrases;
    } catch (error) {
      lastError = error;
      console.warn(`⚠️ AI 生成例句失败（第 ${attempt}/${maxRetries} 次尝试）: ${error.message}`);
      
      if (attempt < maxRetries) {
        // 等待后重试
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }
  
  // 所有重试都失败，抛出最后一次的错误
  throw lastError || new Error('AI 生成例句失败');
}

/**
 * 调用 AI 生成单词例句（单次尝试）
 * @param {string} label - 英文单词
 * @param {string} apiKey - 智谱 AI API 密钥
 * @returns {Promise<Array<{e: string, c: string}>>} 例句数组
 */
async function generatePhrasesWithAI(label, apiKey) {
  const messages = [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text:
            `你是一个英语老师。用户查询了单词"${label}"，` +
            `请针对这个单词给出 2 个短小地道的英语口语例句，并带中文翻译。严禁任何开场白，直接返回纯 JSON。\n` +
            `使用极简字段名：e 表示英文，c 表示中文。\n` +
            `生成的英文例句单词之间保持正常空格。\n` +
            `关键要求：生成的中文翻译必须根据语义词组使用空格进行分隔。例如：不要输出'他正在吃苹果'，必须输出'他 正在 吃 苹果'。\n` +
            `在生成中文翻译时，请按自然的语义词组（而不是单个汉字）进行空格分隔。例如：输出'煎鱼 的 时候 记得 打开 抽油烟机'，而不是'煎 鱼 的 时 候...'。\n` +
            `确保专有名词（如'抽油烟机'、'冰箱'）作为一个整体词块，中间不要加空格。\n` +
            `⚠️ 关键约束：每个 e 字段必须且只能包含一个完整的英语句子。严禁将两个或多个句子合并到一个 e 字段中，只能有一个句号或感叹号或问号。\n` +
            `⚠️ 每个 c 字段也必须且只能包含一个完整的中文句子，只能有一个句号或感叹号或问号。\n` +
            `必须且只能返回 JSON 格式数据，结构如下（不要 Markdown 标记）：\n` +
            `{"phrases":[{"e":"英文例句1","c":"中文翻译1"},{"e":"英文例句2","c":"中文翻译2"}]}\n` +
            `请确保 JSON 结构完整，必须以 } 结尾。`,
        },
      ],
    },
  ];

  const requestBody = {
    model: 'glm-4.6v',
    messages: messages,
    max_tokens: 1024,
    temperature: 0.5,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  let response;
  try {
    response = await fetch(ZHIPU_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
  } catch (fetchError) {
    clearTimeout(timeoutId);
    if (fetchError.name === 'AbortError') {
      throw new Error('请求例句超时');
    }
    throw new Error(`网络请求失败: ${fetchError.message}`);
  }
  clearTimeout(timeoutId);

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`请求失败 (${response.status}): ${errorBody || response.statusText}`);
  }

  const result = await response.json();
  const content = result.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('API 返回内容为空');
  }

  const jsonString = extractJsonFromText(content);

  const parsed = safeParseJson(jsonString);
  if (!Array.isArray(parsed.phrases)) {
    throw new Error('返回数据缺少 phrases 字段');
  }
  
  if (parsed.phrases.length < 2) {
    throw new Error(`AI 返回例句不足（仅返回 ${parsed.phrases.length} 条，需要至少 2 条）`);
  }
  
  return parsed.phrases;
}

/**
 * 搜索单词定义（查词功能）- 增强版
 * 返回更丰富的词条信息：翻译、词性、用法说明、3个不同语境例句
 * @param {string} word - 要查询的英文单词
 * @param {string} apiKey - 智谱 AI API 密钥
 * @returns {Promise<{
 *   l: string,
 *   t: string,
 *   pos: string,
 *   usage: string,
 *   examples: Array<{e: string, c: string}>
 * }>}
 */
export async function searchWordDefinition(word, apiKey) {
  if (!word || !apiKey) {
    throw new Error('缺少必要参数 word 或 apiKey');
  }

  const messages = [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text:
            `你是一个权威英语词典。请针对单词"${word}"，给出：\n` +
            `1. 中文翻译\n` +
            `2. 词性及详细用法说明\n` +
            `3. 3个不同语境下的地道例句\n` +
            `使用极简字段名：l 表示英文名，t 表示中文翻译，pos 表示词性，usage 表示用法说明，examples 为例句数组（每个例句 e 表示英文，c 表示中文）。\n` +
            `⚠️ 关键约束：每个 e 字段必须且只能包含一个完整的英语句子。严禁将两个或多个句子合并到一个 e 字段中，只能有一个句号或感叹号或问号。\n` +
            `⚠️ 每个 c 字段也必须且只能包含一个完整的中文句子，只能有一个句号或感叹号或问号。\n` +
            `必须且只能返回纯 JSON（不要 Markdown 标记），结构如下：\n` +
            `{"l":"${word}","t":"翻译","pos":"词性","usage":"用法说明","examples":[{"e":"例句1","c":"翻译1"},{"e":"例句2","c":"翻译2"},{"e":"例句3","c":"翻译3"}]}\n` +
            `请确保 JSON 结构完整，必须以 } 结尾。`,
        },
      ],
    },
  ];

  const requestBody = {
    model: 'glm-4.6v',
    messages: messages,
    max_tokens: 2048,
    temperature: 0.3,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  let response;
  try {
    response = await fetch(ZHIPU_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
  } catch (fetchError) {
    clearTimeout(timeoutId);
    if (fetchError.name === 'AbortError') {
      throw new Error('查词请求超时');
    }
    throw new Error(`网络请求失败: ${fetchError.message}`);
  }
  clearTimeout(timeoutId);

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`请求失败 (${response.status}): ${errorBody || response.statusText}`);
  }

  const result = await response.json();
  const content = result.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('API 返回内容为空');
  }

  const jsonString = extractJsonFromText(content);

  try {
    const parsed = safeParseJson(jsonString);
    if (!parsed.l || !parsed.t || !Array.isArray(parsed.examples)) {
      throw new Error('返回数据缺少必要字段（l, t, examples）');
    }
    // 兼容旧版 phrases 字段
    return {
      l: parsed.l,
      t: parsed.t,
      pos: parsed.pos || '',
      usage: parsed.usage || '',
      examples: parsed.examples || parsed.phrases || [],
    };
  } catch (parseError) {
    console.error('=== 查词返回原始内容 ===');
    console.error(content);
    throw new Error(`解析查词结果失败: ${parseError.message}`);
  }
}

/**
 * 从 API 返回的完整响应中提取 token 用量信息
 * @param {Object} response - fetch 返回的原始响应 JSON
 * @returns {Object|null} { prompt_tokens, completion_tokens, total_tokens }
 */
export function extractUsage(response) {
  return response?.usage || null;
}

/**
 * DeepSeek 口语评分（AI 教研专家）
 * 
 * 系统角色：专业英语口语教研专家
 * 对比目标文本与语音识别结果，给出专业中肯的评估
 * 
 * @param {string} targetText - 目标单词/句子
 * @param {string} recognizedText - 语音识别出的文本
 * @param {string} apiKey - DeepSeek API Key（可选，优先使用 .env 中的配置）
 * @returns {Promise<{
 *   score: number,
 *   accuracy: string,
 *   feedback: string,
 *   phonetic_tips: string
 * }>}
 */
export async function evaluatePronunciationWithDeepSeek(
  targetText,
  recognizedText,
  apiKey
) {
  const key = apiKey || DEEPSEEK_API_KEY;

  if (!key || key === 'your-deepseek-api-key-here') {
    throw new Error('请在 .env 中配置 EXPO_PUBLIC_DEEPSEEK_API_KEY');
  }

  if (!targetText || targetText.trim().length === 0) {
    throw new Error('缺少目标文本 (targetText)');
  }

  // 空识别结果快速返回 0 分
  const cleanedReco = (recognizedText || '').trim();
  if (!cleanedReco || cleanedReco.length < 1) {
    return {
      score: 0,
      accuracy: '未检测到有效声音',
      feedback: '请靠近麦克风大声朗读，确保录音环境安静',
      phonetic_tips: '先听一遍标准发音，再尝试跟读',
    };
  }

  const messages = [
    {
      role: 'system',
      content:
        '你是一位专业的英语口语教研专家。用户会提供"目标单词/句子"以及"语音识别出的文本"。你的任务是对比两者，给出专业、中肯的评估。',
    },
    {
      role: 'user',
      content:
        `Target: ${targetText.trim()}\n\nRecognized: ${cleanedReco}`,
    },
  ];

  const requestBody = {
    model: 'deepseek-chat',
    messages: messages,
    max_tokens: 1024,
    temperature: 0.3,
    response_format: { type: 'json_object' },
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  let response;
  try {
    response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
  } catch (fetchError) {
    clearTimeout(timeoutId);
    if (fetchError.name === 'AbortError') {
      throw new Error('DeepSeek 评分请求超时（30 秒）');
    }
    throw new Error(`DeepSeek 网络请求失败: ${fetchError.message}`);
  }
  clearTimeout(timeoutId);

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(
      `DeepSeek API 请求失败 (${response.status}): ${errorBody || response.statusText}`
    );
  }

  const result = await response.json();
  const content = result.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('DeepSeek API 返回内容为空');
  }

  try {
    const parsed = JSON.parse(content);

    // 验证必要字段
    if (
      typeof parsed.score !== 'number' ||
      typeof parsed.accuracy !== 'string' ||
      typeof parsed.feedback !== 'string' ||
      typeof parsed.phonetic_tips !== 'string'
    ) {
      console.warn('[DeepSeek] 返回字段不完整，使用兜底:', parsed);
      return {
        score: parsed.score ?? 0,
        accuracy: parsed.accuracy || '评分数据不完整',
        feedback: parsed.feedback || '请重新录音后再次尝试',
        phonetic_tips: parsed.phonetic_tips || '建议先听标准发音再跟读',
      };
    }

    // 约束 score 在 0-100 范围
    return {
      score: Math.max(0, Math.min(100, Math.round(parsed.score))),
      accuracy: parsed.accuracy,
      feedback: parsed.feedback,
      phonetic_tips: parsed.phonetic_tips,
    };
  } catch (parseError) {
    console.error('=== DeepSeek 返回原始内容 ===');
    console.error(content);
    throw new Error(`DeepSeek 评分结果解析失败: ${parseError.message}`);
  }
}


/**
 * 单词详情数据结构
 * @typedef {Object} WordDetailData
 * @property {string} word - 英文单词
 * @property {string} definition - 中文释义
 * @property {string} example_en_1 - 英文例句 1
 * @property {string} example_cn_1 - 中文翻译 1
 * @property {string} example_en_2 - 英文例句 2
 * @property {string} example_cn_2 - 中文翻译 2
 */

/**
 * 获取单词详情（带 Supabase 云端词库缓存机制）
 *
 * 三级检索逻辑：
 * 1. 查云端：向 Supabase 发起请求查询 shared_word_bank 表
 * 2. 命中缓存：如果查到数据，直接返回，禁止调用 AI
 * 3. AI 补偿：如果云端没有数据，调用 AI 生成，生成后存入云端
 *
 * 错误降级：
 * - Supabase 连接失败或网络超时 → 自动切换为纯 AI 生成模式
 * - AI 生成失败 → 抛出错误，由调用方处理
 *
 * @param {string} word - 英文单词
 * @param {string} apiKey - 智谱 AI API 密钥
 * @returns {Promise<WordDetailData>} 单词详情
 */
/**
 * 数据完整性校验：检查 AI 返回的单词数据是否包含所有必要字段
 * @param {Object} data - 单词数据对象
 * @param {string} data.word - 单词
 * @param {string} data.definition - 中文翻译
 * @param {string} data.example_en_1 - 第一个英文例句
 * @param {string} data.example_cn_1 - 第一个中文例句
 * @param {string} data.example_en_2 - 第二个英文例句
 * @param {string} data.example_cn_2 - 第二个中文例句
 * @returns {{ valid: boolean, missingFields: string[] }}
 */
function isDataComplete(data) {
  const missingFields = [];

  // 1. 检查 word（非空字符串）
  if (!data.word || typeof data.word !== 'string' || data.word.trim() === '') {
    missingFields.push('word');
  }

  // 2. 检查 definition（非空字符串）
  if (!data.definition || typeof data.definition !== 'string' || data.definition.trim() === '') {
    missingFields.push('definition');
  }

  // 3. 检查两个例句是否完整
  // 第一个例句：英文和中文都必须非空
  const ex1En = data.example_en_1;
  const ex1Cn = data.example_cn_1;
  const hasEx1 = ex1En && typeof ex1En === 'string' && ex1En.trim() !== ''
    && ex1Cn && typeof ex1Cn === 'string' && ex1Cn.trim() !== '';

  // 第二个例句：英文和中文都必须非空
  const ex2En = data.example_en_2;
  const ex2Cn = data.example_cn_2;
  const hasEx2 = ex2En && typeof ex2En === 'string' && ex2En.trim() !== ''
    && ex2Cn && typeof ex2Cn === 'string' && ex2Cn.trim() !== '';

  if (!hasEx1) {
    missingFields.push('example_en_1 / example_cn_1');
  }
  if (!hasEx2) {
    missingFields.push('example_en_2 / example_cn_2');
  }

  return {
    valid: missingFields.length === 0,
    missingFields,
  };
}

/**
 * 调用 AI 生成单词详情（单次尝试）
 */
async function callAiForWordDetails(word, apiKey) {
  const messages = [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text:
            `你是一个英语词典专家。请为单词 "${word}" 提供：\n` +
            `1. 中文翻译（definition）\n` +
            `2. 两个不同语境的地道英语口语例句，每个例句附带中文翻译\n` +
            `⚠️ 重要：严禁使用 "I see a..."、"I found a..." 这样的简单句式。例句必须是真实场景对话，如询问、描述、感叹、建议等不同语气。\n` +
            `⚠️ 关键约束：每个英文例句必须且只能包含一个完整的英语句子。严禁将两个或多个句子合并到一个英文例句中，只能有一个句号或感叹号或问号。\n` +
            `⚠️ 每个中文翻译也必须且只能包含一个完整的中文句子，只能有一个句号或感叹号或问号。\n` +
            `⚠️ 重要：You MUST return exactly 2 example sentences for each word in JSON format. If you cannot provide them, return an error instead of an empty field.（你必须为每个单词返回准确的 2 个例句。如果无法提供，请返回错误而不是空字段。）\n` +
            `必须返回纯 JSON 格式（不要任何 Markdown 标记或额外文字）：\n` +
            `{\n` +
            `  "word": "${word}",\n` +
            `  "definition": "中文翻译",\n` +
            `  "example_en_1": "第一个英文例句",\n` +
            `  "example_cn_1": "第一个中文翻译",\n` +
            `  "example_en_2": "第二个英文例句",\n` +
            `  "example_cn_2": "第二个中文翻译"\n` +
            `}\n` +
            `请确保 JSON 结构完整，必须以 } 结尾。`,
        },
      ],
    },
  ];

  const requestBody = {
    model: 'glm-4.6v',
    messages: messages,
    max_tokens: 2048,
    temperature: 0.3,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  let response;
  try {
    response = await fetch(ZHIPU_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
  } catch (fetchError) {
    clearTimeout(timeoutId);
    if (fetchError.name === 'AbortError') {
      throw new Error(`TIMEOUT:AI 生成单词详情超时（30 秒），请重试。`);
    }
    throw new Error(`网络请求失败: ${fetchError.message}`);
  }
  clearTimeout(timeoutId);

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`请求失败 (${response.status}): ${errorBody || response.statusText}`);
  }

  const result = await response.json();
  const content = result.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('API 返回内容为空');
  }

  const jsonString = extractJsonFromText(content);

  let parsed;
  try {
    parsed = safeParseJson(jsonString);
  } catch (parseError) {
    console.error('=== fetchWordDetails 返回原始内容 ===');
    console.error(content);
    console.error('=== 提取的 JSON 字符串 ===');
    console.error(jsonString);
    throw new Error(`解析 AI 返回结果失败: ${parseError.message}`);
  }

  // 验证必要字段
  if (!parsed.word || !parsed.definition) {
    throw new Error('AI 返回数据缺少必要字段（word, definition）');
  }

  return {
    word: parsed.word,
    definition: parsed.definition,
    example_en_1: parsed.example_en_1 || '',
    example_cn_1: parsed.example_cn_1 || '',
    example_en_2: parsed.example_en_2 || '',
    example_cn_2: parsed.example_cn_2 || '',
  };
}

export async function fetchWordDetails(word, apiKey) {
  if (!word || !apiKey) {
    throw new Error('缺少必要参数 word 或 apiKey');
  }

  // ====== 第一步：查云端 ======
  const cachedData = await fetchWordFromBank(word);
  if (cachedData && cachedData.definition) {
    // 命中缓存，检查缓存数据是否完整
    const cacheCheck = isDataComplete({
      word: cachedData.word,
      definition: cachedData.definition,
      example_en_1: cachedData.example_en_1 || '',
      example_cn_1: cachedData.example_cn_1 || '',
      example_en_2: cachedData.example_en_2 || '',
      example_cn_2: cachedData.example_cn_2 || '',
    });
    if (cacheCheck.valid) {
      console.log(`✅ Supabase 缓存命中（数据完整）: ${word}`);
      return {
        word: cachedData.word,
        definition: cachedData.definition,
        example_en_1: cachedData.example_en_1 || '',
        example_cn_1: cachedData.example_cn_1 || '',
        example_en_2: cachedData.example_en_2 || '',
        example_cn_2: cachedData.example_cn_2 || '',
      };
    }
    // 缓存数据不完整，忽略缓存，重新请求 AI
    console.warn(`⚠️ Supabase 缓存数据不完整（缺少: ${cacheCheck.missingFields.join(', ')}），将重新请求 AI: ${word}`);
  }

  // ====== 第二步：云端未命中（或缓存不完整），调用 AI 生成 ======
  console.log(`🤖 AI 正在生成新词并同步云端: ${word}`);

  // 首次尝试
  let wordDetail = await callAiForWordDetails(word, apiKey);

  // 数据完整性校验
  let check = isDataComplete(wordDetail);
  if (!check.valid) {
    console.warn(`⚠️ AI 首次返回数据不完整（缺少: ${check.missingFields.join(', ')}），将自动重试一次: ${word}`);

    // 自动重试（仅一次）
    wordDetail = await callAiForWordDetails(word, apiKey);

    // 重试后再次校验
    check = isDataComplete(wordDetail);
    if (!check.valid) {
      console.error(`❌ AI 重试后数据仍不完整（缺少: ${check.missingFields.join(', ')}），放弃保存: ${word}`);
      throw new Error(
        `数据生成不完整，请尝试重新识别。缺失字段: ${check.missingFields.join(', ')}`
      );
    }
  }

  console.log(`✅ AI 数据完整性校验通过: ${word}`);

  // ====== 第三步：AI 生成成功后，异步存入云端（fire-and-forget）======
  upsertWordToBank(
    wordDetail.word,
    wordDetail.definition,
    wordDetail.example_en_1,
    wordDetail.example_cn_1,
    wordDetail.example_en_2,
    wordDetail.example_cn_2,
  ).catch(() => {});

  return wordDetail;
}
