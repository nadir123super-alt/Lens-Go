/**
 * XFXmlParser — 讯飞语音评测 ISE 返回 XML 解析器
 *
 * 使用 fast-xml-parser 将 ISE 返回的 XML 转换为结构化的 JSON 对象，
 * 方便 UI 渲染。同时保留正则解析作为 fallback（RN 环境兼容性）。
 *
 * 增强功能：
 *   - 自动识别中/英文评测（cn_vip / en_vip）
 *   - 中文：解析 syll 节点 → 声母/韵母/声调正确性
 *   - 英文：解析 phone 节点 → 标准音标 vs 用户发音
 *   - 分数归一化：任意分制 → 统一 0-100
 *   - dp_message 错误标签：转换为可读字符串（含中文描述）
 *
 * 参考文档：https://www.xfyun.cn/doc/Ise/Ise-API.html
 */

// ========== 类型定义 ==========

/** 评测语言 */
export type DetectedLanguage = 'cn' | 'en' | 'unknown';

/** 单词发音错误类型 */
export type WordErrorType = 'normal' | 'miss' | 'extra' | 'backtrack' | 'replace' | 'unknown';

/**
 * dp_message → 人类可读标签（含中英文描述）
 */
export interface DpMessageLabel {
  /** 错误类型枚举 */
  type: WordErrorType;
  /** 中文描述 */
  cn: string;
  /** 英文描述 */
  en: string;
}

/**
 * dp_message 枚举映射（扩展版，返回完整标签）
 *
 *   0   → normal    正常/Correct
 *   16  → miss      漏读/Missing
 *   32  → extra     增读/Extra
 *   64  → backtrack 回读/Backtrack
 *   128 → replace   替换/Replaced
 */
const DP_MESSAGE_MAP: Record<number, DpMessageLabel> = {
  0:   { type: 'normal',    cn: '正确',   en: 'Correct' },
  16:  { type: 'miss',      cn: '漏读',   en: 'Missing' },
  32:  { type: 'extra',     cn: '增读',   en: 'Extra' },
  64:  { type: 'backtrack', cn: '回读',   en: 'Backtrack' },
  128: { type: 'replace',   cn: '替换',   en: 'Replaced' },
};

function getDpLabel(dp: number): DpMessageLabel {
  return DP_MESSAGE_MAP[dp] ?? { type: 'unknown', cn: '未知', en: 'Unknown' };
}

/** @deprecated 使用 getDpLabel(dp).type 代替 */
function mapDpMessage(dp: number): WordErrorType {
  return getDpLabel(dp).type;
}

// ========== 中文音节（Syllable） ==========

/** 单个音节评测结果（中文特有） */
export interface ParsedSyll {
  /** 音节内容，如 "ni", "hao" */
  content: string;
  /** 音节总得分 (0-100 归一化) */
  score: number;
  /** 声母（initial consonant），如 "n", "h", 空字符串表示零声母 */
  initial: string;
  /** 韵母（final），如 "i", "ao" */
  final: string;
  /** 声调值 1-5 */
  tone: number;
  /** 声母是否正确 */
  initialCorrect: boolean;
  /** 韵母是否正确 */
  finalCorrect: boolean;
  /** 声调是否正确 */
  toneCorrect: boolean;
  /** 错误标签 */
  errorLabel: DpMessageLabel;
}

// ========== 英文音素（Phoneme） ==========

/** 单个音素评测结果（英文特有） */
export interface ParsedPhone {
  /** 标准音标，如 "AE", "TH" */
  standard: string;
  /** 用户实际发音的音标 */
  user: string;
  /** 该音素得分 (0-100 归一化) */
  score: number;
  /** 重音等级 0-3 */
  stress: number;
  /** 发音是否正确 */
  correct: boolean;
  /** 错误标签 */
  errorLabel: DpMessageLabel;
}

// ========== 逐词详情 ==========

/** 每个单词的评测详情 */
export interface ParsedWord {
  /** 单词文本 */
  text: string;
  /** 该词得分 (0-100 归一化) */
  score: number;
  /** 错误类型枚举 */
  errorType: WordErrorType;
  /** 原始 dp_message 值 */
  dpMessage: number;
  /** 人类可读错误标签（含中英文） */
  errorLabel: DpMessageLabel;
  /** 中文评测：音节列表 */
  sylls?: ParsedSyll[];
  /** 英文评测：音素列表 */
  phones?: ParsedPhone[];
}

// ========== 维度分数 ==========

/** 维度分数 */
export interface ParsedDimensions {
  total_score: number;
  accuracy_score: number;
  fluency_score: number;
  integrity_score: number;
}

// ========== 最终结果 ==========

/** XFXmlParser 最终输出 */
export interface ParsedIseResult {
  /** 总分 (0-100 归一化) */
  totalScore: number;
  /** 维度分 (0-100 归一化) */
  dimensions: ParsedDimensions;
  /** 逐词详情 */
  words: ParsedWord[];
  /** 检测到的评测语言 */
  detectedLanguage: DetectedLanguage;
  /** 分数是否经过归一化转换 */
  scoreNormalized: boolean;
  /** 完整解析后的 JS 对象 (调试用) */
  rawParsed: Record<string, any>;
  /** 解析错误信息（无错误时为 undefined） */
  error?: string;
}

// ========== 分数归一化 ==========

/**
 * 将讯飞返回的分数统一映射为 0-100 数值区间
 *
 * 检测规则：
 *   - 所有维度分 ≤ 10 且存在 > 0 的值 → 5 分制 → ×20 到百分制
 *   - 所有维度分 ≤ 10 且最大值 > 5 → 10 分制 → ×10 到百分制
 *   - 否则假定已是百分制，直接使用
 *
 * @returns { normalized: ParsedDimensions, wasNormalized: boolean }
 */
function normalizeScores(dimensions: ParsedDimensions): {
  normalized: ParsedDimensions;
  wasNormalized: boolean;
} {
  const scores = [
    dimensions.total_score,
    dimensions.accuracy_score,
    dimensions.fluency_score,
    dimensions.integrity_score,
  ];
  const maxScore = Math.max(...scores);
  const allNonNegative = scores.every(s => s >= 0);

  // 全部 ≤ 10 → 小分制，需要放大
  if (allNonNegative && maxScore <= 10 && maxScore > 0) {
    // 判断是 5 分制还是 10 分制
    // 如果总分或维度分中有 > 5 的值，可能是 10 分制
    const hasAbove5 = scores.some(s => s > 5 && s <= 10);
    const multiplier = hasAbove5 ? 10 : 20;

    console.log(`[XFXmlParser] 🔄 分数归一化: ${hasAbove5 ? '10分制' : '5分制'} → ×${multiplier} → 百分制, max=${maxScore}`);

    return {
      normalized: {
        total_score: Math.round(dimensions.total_score * multiplier),
        accuracy_score: Math.round(dimensions.accuracy_score * multiplier),
        fluency_score: Math.round(dimensions.fluency_score * multiplier),
        integrity_score: Math.round(dimensions.integrity_score * multiplier),
      },
      wasNormalized: true,
    };
  }

  return { normalized: dimensions, wasNormalized: false };
}

// ========== fast-xml-parser 选项 ==========

/**
 * fast-xml-parser 配置
 *
 * ignoreAttributes: false  — 属性也解析（word 节点可能以属性形式传 content/score）
 * isArray: 动态包装    — 标签名按需要包装成数组（word/syll/phone 标签强制数组）
 * removeNSPrefix: true — 移除命名空间前缀
 */
const XML_PARSER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // 强制将以下标签始终包裹为数组，避免单元素丢失
  isArray: (name: string) => {
    return name === 'word'
      || name === 'sentence'
      || name === 'read_sentence'
      || name === 'read_chapter'
      || name === 'read_word'
      || name === 'syll'
      || name === 'phone'
      || name === 'tone';
  },
  removeNSPrefix: true,
  textNodeName: '#text',
  ignoreDeclaration: true,
  ignorePiTags: true,
  ignoreComment: true,
};

// 动态导入 fast-xml-parser（避免 RN 环境 require 报错）
let fastXmlParser: any = null;

async function ensureParser(): Promise<any> {
  if (fastXmlParser) return fastXmlParser;
  try {
    const pkg = require('fast-xml-parser');
    fastXmlParser = pkg;
    return pkg;
  } catch {
    console.warn('[XFXmlParser] ⚠️ fast-xml-parser 不可用，回退到正则解析');
    return null;
  }
}

// ========== XFXmlParser 类 ==========

export class XFXmlParser {
  /**
   * 解析 ISE 返回的 XML 字符串（异步版本，带全局 try-catch 保护）
   *
   * 合并处理：内部会累积所有中间数据片段后再统一解析，
   * 防止因 XML 截断导致解析失败。
   *
   * 错误捕获：所有异常都在内部处理，返回带 error 字段的默认对象，
   * 不会抛出异常导致调用链崩溃。
   *
   * @param xmlString - Base64 解码后的 XML 字符串
   * @returns 结构化的 ParsedIseResult（发生错误时 error 字段非空，其他字段为安全默认值）
   */
  static async parse(xmlString: string): Promise<ParsedIseResult> {
    return XFXmlParser.safeParseWrapper(xmlString, async () => {
      if (!xmlString || xmlString.trim().length === 0) {
        return XFXmlParser.emptyResult('XML 字符串为空');
      }

      const parser = await ensureParser();

      if (parser) {
        return XFXmlParser.parseWithFastXml(xmlString, parser);
      }

      console.log('[XFXmlParser] 🔄 使用正则 fallback 解析');
      return XFXmlParser.parseWithRegex(xmlString);
    });
  }

  /**
   * 同步版本，仅在 fast-xml-parser 可用时使用
   * 不可用则回退到正则
   *
   * 同样具备全局 try-catch 保护，不会抛出异常
   */
  static parseSync(xmlString: string): ParsedIseResult {
    return XFXmlParser.safeParseWrapperSync(xmlString, () => {
      if (!xmlString || xmlString.trim().length === 0) {
        return XFXmlParser.emptyResult('XML 字符串为空');
      }

      try {
        const parser = require('fast-xml-parser');
        return XFXmlParser.parseWithFastXml(xmlString, parser);
      } catch {
        console.log('[XFXmlParser] 🔄 fast-xml-parser 不可用，使用正则 fallback');
        return XFXmlParser.parseWithRegex(xmlString);
      }
    });
  }

  /**
   * 全局异步 try-catch 包装器
   * - 捕获所有解析异常
   * - 合并处理：确保接收到完整 XML 后再解析（在 parse 调用时 XML 已拼接完成）
   * - 错误时返回带 error 说明的安全默认对象
   */
  private static async safeParseWrapper(
    xmlString: string,
    fn: () => Promise<ParsedIseResult>,
  ): Promise<ParsedIseResult> {
    try {
      const result = await fn();
      return result;
    } catch (err: any) {
      const errorMsg = err?.message ?? String(err);
      console.error('[XFXmlParser] ❌ 解析异常（已捕获）:', errorMsg);
      console.error('[XFXmlParser] ❌ 原始 XML (前 1000 字符):', xmlString?.substring(0, 1000));
      return XFXmlParser.emptyResult(`解析异常: ${errorMsg}`);
    }
  }

  /**
   * 全局同步 try-catch 包装器
   */
  private static safeParseWrapperSync(
    xmlString: string,
    fn: () => ParsedIseResult,
  ): ParsedIseResult {
    try {
      const result = fn();
      return result;
    } catch (err: any) {
      const errorMsg = err?.message ?? String(err);
      console.error('[XFXmlParser] ❌ 解析异常（已捕获）:', errorMsg);
      console.error('[XFXmlParser] ❌ 原始 XML (前 1000 字符):', xmlString?.substring(0, 1000));
      return XFXmlParser.emptyResult(`解析异常: ${errorMsg}`);
    }
  }

  // ========== fast-xml-parser 路径 ==========

  private static parseWithFastXml(xmlString: string, parser: any): ParsedIseResult {
    const { XMLParser } = parser;
    const xmlParser = new XMLParser(XML_PARSER_OPTIONS);

    let parsedObj: Record<string, any>;
    try {
      parsedObj = xmlParser.parse(xmlString);
    } catch (err: any) {
      console.warn('[XFXmlParser] ⚠️ fast-xml-parser 解析失败，回退正则:', err?.message);
      return XFXmlParser.parseWithRegex(xmlString);
    }

    console.log('[XFXmlParser] 📄 fast-xml-parser 解析成功');

    // ===== 支持多种题型路径 =====
    // 英语单词: xml_result → read_word → rec_paper → read_word → sentence → word
    // 英语句子: xml_result → read_sentence → rec_paper → read_sentence → sentence → word
    // 中文字词: xml_result → read_word → rec_paper → read_word → sentence → word
    const xmlRoot = parsedObj?.xml_result ?? parsedObj;

    // 尝试 read_word 路径（单词题型）
    const readWordRoot = xmlRoot?.read_word;
    const innerReadWord =
      readWordRoot?.rec_paper?.read_word
      ?? readWordRoot;

    // 尝试 read_sentence 路径（句子+篇章题型）
    const readSentRoot = xmlRoot?.read_sentence;
    const innerReadSentence =
      readSentRoot?.rec_paper?.read_sentence
      ?? readSentRoot;

    // 选择有数据的分支：优先 read_word（单词题型常见），其次 read_sentence
    const innerNode = (innerReadWord?.word || innerReadWord?.sentence)
      ? innerReadWord
      : innerReadSentence;

    // 提取原始维度分
    const rawDimensions: ParsedDimensions = {
      total_score: XFXmlParser.parseFloatSafe(innerNode?.total_score),
      accuracy_score: XFXmlParser.parseFloatSafe(innerNode?.accuracy_score),
      fluency_score: XFXmlParser.parseFloatSafe(innerNode?.fluency_score),
      integrity_score: XFXmlParser.parseFloatSafe(innerNode?.integrity_score),
    };

    // 分数归一化
    const { normalized: dimensions, wasNormalized } = normalizeScores(rawDimensions);

    // 提取逐词详情 + 自动检测语言
    const rawWords = innerNode?.word;
    const words: ParsedWord[] = XFXmlParser.extractWords(rawWords);

    // 自动检测评测语言
    const detectedLanguage = XFXmlParser.detectLanguage(words, xmlString);

    console.log('[XFXmlParser] 📊 解析完成:', {
      totalScore: dimensions.total_score,
      detectedLanguage,
      scoreNormalized: wasNormalized,
      wordCount: words.length,
      errorWords: words.filter(w => w.errorType !== 'normal').length,
    });

    return {
      totalScore: dimensions.total_score,
      dimensions,
      words,
      detectedLanguage,
      scoreNormalized: wasNormalized,
      rawParsed: parsedObj,
    };
  }

  // ========== 正则 fallback 路径 ==========

  private static parseWithRegex(xmlString: string): ParsedIseResult {
    const extract = (tag: string): number => {
      const match = xmlString.match(new RegExp(`<${tag}>(.+?)</${tag}>`));
      if (match) {
        const num = parseFloat(match[1]);
        return isNaN(num) ? 0 : num;
      }
      return 0;
    };

    const rawDimensions: ParsedDimensions = {
      total_score: extract('total_score'),
      accuracy_score: extract('accuracy_score'),
      fluency_score: extract('fluency_score'),
      integrity_score: extract('integrity_score'),
    };

    const { normalized: dimensions, wasNormalized } = normalizeScores(rawDimensions);

    // 正则提取 word 节点（支持 <word>...</word> 和 <word ... /> 两种格式）
    const wordRegex = /<word[^>]*>([\s\S]*?)<\/word>|<word([^/>]*)\/>/g;
    const words: ParsedWord[] = [];
    let match: RegExpExecArray | null;

    while ((match = wordRegex.exec(xmlString)) !== null) {
      let w: ParsedWord;

      if (match[2] !== undefined) {
        // 自闭合标签：<word content="hello" total_score="90" dp_message="0"/>
        const text = XFXmlParser.extractAttr(match[2], 'content');
        const score = XFXmlParser.parseFloatSafe(XFXmlParser.extractAttr(match[2], 'total_score'));
        const dpMessage = parseInt(XFXmlParser.extractAttr(match[2], 'dp_message') || '0', 10) || 0;
        const errorLabel = getDpLabel(dpMessage);
        w = {
          text: text || '',
          score: XFXmlParser.normalizeWordScore(score, wasNormalized),
          errorType: errorLabel.type,
          dpMessage,
          errorLabel,
        };
      } else if (match[1] !== undefined) {
        // 子元素标签：<word> ... </word>
        const inner = match[1];
        const text = XFXmlParser.extractChild(inner, 'content');
        const score = XFXmlParser.extractChildNumeric(inner, 'total_score');
        const dp = XFXmlParser.extractChildNumeric(inner, 'dp_message');
        const errorLabel = getDpLabel(dp);
        w = {
          text: text || '',
          score: XFXmlParser.normalizeWordScore(score, wasNormalized),
          errorType: errorLabel.type,
          dpMessage: dp,
          errorLabel,
        };

        // 中文：尝试正则提取 syll 节点
        const sylls = XFXmlParser.regexExtractSylls(inner);
        if (sylls.length > 0) w.sylls = sylls;

        // 英文：尝试正则提取 phone 节点
        const phones = XFXmlParser.regexExtractPhones(inner);
        if (phones.length > 0) w.phones = phones;
      } else {
        continue;
      }

      words.push(w);
    }

    const detectedLanguage = XFXmlParser.detectLanguage(words, xmlString);

    console.log('[XFXmlParser] 📊 正则解析完成:', {
      totalScore: dimensions.total_score,
      detectedLanguage,
      scoreNormalized: wasNormalized,
      wordCount: words.length,
      errorWords: words.filter(w => w.errorType !== 'normal').length,
    });

    return {
      totalScore: dimensions.total_score,
      dimensions,
      words,
      detectedLanguage,
      scoreNormalized: wasNormalized,
      rawParsed: {},
    };
  }

  // ========== 语言检测 ==========

  /**
   * 自动检测评测语言
   *
   * 检测策略（优先级）：
   *   1. 检查 words 中是否有 sylls → 中文（cn）
   *   2. 检查 words 中是否有 phones → 英文（en）
   *   3. 检查 XML 原始文本中是否包含 <syll> 标签 → 中文
   *   4. 检查 XML 原始文本中是否包含 <phone> 标签 → 英文
   *   5. 兜底返回 'unknown'
   */
  private static detectLanguage(words: ParsedWord[], xmlString: string): DetectedLanguage {
    // 优先从解析结果判断
    const hasSylls = words.some(w => w.sylls && w.sylls.length > 0);
    if (hasSylls) return 'cn';

    const hasPhones = words.some(w => w.phones && w.phones.length > 0);
    if (hasPhones) return 'en';

    // 从 XML 原始文本判断（fast-xml-parser 可能把 syll 嵌套到 word 里）
    if (/<syll\b/i.test(xmlString)) return 'cn';
    if (/<phone\b/i.test(xmlString)) return 'en';

    return 'unknown';
  }

  // ========== 逐词提取 ==========

  /** 提取 word 数组（含音节/音素子节点） */
  private static extractWords(wordData: any): ParsedWord[] {
    if (!wordData) return [];

    const wordArray = Array.isArray(wordData) ? wordData : [wordData];

    return wordArray.map((w: any) => {
      // 文本：优先子元素，其次属性
      const text =
        w?.content?.['#text']
        ?? w?.content
        ?? w?.['@_content']
        ?? w?.['@_text']
        ?? '';

      const score = XFXmlParser.parseFloatSafe(
        w?.total_score?.['#text']
        ?? w?.total_score
        ?? w?.['@_total_score']
      );

      const dpMessage = parseInt(
        w?.dp_message?.['#text']
        ?? w?.dp_message
        ?? w?.['@_dp_message']
        ?? '0',
        10,
      ) || 0;

      const errorLabel = getDpLabel(dpMessage);

      const word: ParsedWord = {
        text: String(text).trim(),
        score,
        errorType: errorLabel.type,
        dpMessage,
        errorLabel,
      };

      // ===== 中文：提取 syll 音节节点 =====
      const rawSylls = w?.syll;
      if (rawSylls) {
        const syllArray = Array.isArray(rawSylls) ? rawSylls : [rawSylls];
        word.sylls = syllArray.map((s: any) => XFXmlParser.parseSyll(s));
      }

      // ===== 英文：提取 phone 音素节点 =====
      const rawPhones = w?.phone;
      if (rawPhones) {
        const phoneArray = Array.isArray(rawPhones) ? rawPhones : [rawPhones];
        word.phones = phoneArray.map((p: any) => XFXmlParser.parsePhone(p));
      }

      return word;
    });
  }

  // ========== 中文音节解析 ==========

  /**
   * 解析单个 syll 节点
   *
   * 中文 ISE XML 结构：
   *   <syll content="ni">
   *     <phone content="n" total_score="95" dp_message="0"/>   ← 声母
   *     <tone content="i" total_score="95" dp_message="0"/>    ← 韵母 + 声调
   *   </syll>
   *
   * phone 节点 = 声母（initial consonant），dp_message 表示声母是否正确
   * tone 节点  = 韵母（final）+ 声调，dp_message 表示韵母/声调是否正确
   */
  private static parseSyll(syllNode: any): ParsedSyll {
    const content =
      syllNode?.['@_content']
      ?? syllNode?.content?.['#text']
      ?? syllNode?.content
      ?? '';

    const score = XFXmlParser.parseFloatSafe(
      syllNode?.total_score?.['#text']
      ?? syllNode?.total_score
      ?? syllNode?.['@_total_score']
    );

    // 提取 phone（声母）节点
    const phoneNodes = syllNode?.phone;
    const phoneArray = phoneNodes
      ? (Array.isArray(phoneNodes) ? phoneNodes : [phoneNodes])
      : [];

    let initial = '';
    let initialCorrect = true;
    if (phoneArray.length > 0) {
      const ph = phoneArray[0];
      initial =
        ph?.['@_content']
        ?? ph?.content?.['#text']
        ?? ph?.content
        ?? '';
      const dpMsg = parseInt(
        ph?.dp_message?.['#text']
        ?? ph?.dp_message
        ?? ph?.['@_dp_message']
        ?? '0',
        10,
      ) || 0;
      initialCorrect = dpMsg === 0;
    }

    // 提取 tone（韵母 + 声调）节点
    const toneNodes = syllNode?.tone;
    const toneArray = toneNodes
      ? (Array.isArray(toneNodes) ? toneNodes : [toneNodes])
      : [];

    let final = '';
    let tone = 1;
    let finalCorrect = true;
    let toneCorrect = true;

    if (toneArray.length > 0) {
      const t = toneArray[0];
      const toneContent =
        t?.['@_content']
        ?? t?.content?.['#text']
        ?? t?.content
        ?? '';

      // 韵母部分（去除声调数字）
      final = toneContent.replace(/[0-9]/g, '');

      // 声调数字（1-5，5=轻声）
      const toneMatch = String(toneContent).match(/([0-9])/);
      tone = toneMatch ? parseInt(toneMatch[1], 10) : 1;

      const dpMsg = parseInt(
        t?.dp_message?.['#text']
        ?? t?.dp_message
        ?? t?.['@_dp_message']
        ?? '0',
        10,
      ) || 0;
      // tone dp_message=0 → both final AND tone correct
      // dp_message=16 → miss, 64 → backtrack, 128 → replace
      finalCorrect = dpMsg === 0;
      toneCorrect = dpMsg === 0;
    }

    // syll 级别的 dp_message
    const syllDp = parseInt(
      syllNode?.dp_message?.['#text']
      ?? syllNode?.dp_message
      ?? syllNode?.['@_dp_message']
      ?? '0',
      10,
    ) || 0;

    return {
      content: String(content).trim(),
      score,
      initial: String(initial).trim(),
      final,
      tone,
      initialCorrect,
      finalCorrect,
      toneCorrect,
      errorLabel: getDpLabel(syllDp),
    };
  }

  // ========== 英文音素解析 ==========

  /**
   * 解析单个 phone 节点
   *
   * 英文 ISE XML 结构：
   *   <phone content="ah" total_score="95" stress="0" dp_message="0"/>
   *
   * content = 标准音标（如 "ah", "th", "ae"）
   * dp_message = 0 表示发音正确
   */
  private static parsePhone(phoneNode: any): ParsedPhone {
    const standard =
      phoneNode?.['@_content']
      ?? phoneNode?.content?.['#text']
      ?? phoneNode?.content
      ?? '';

    const rawScore = XFXmlParser.parseFloatSafe(
      phoneNode?.total_score?.['#text']
      ?? phoneNode?.total_score
      ?? phoneNode?.['@_total_score']
    );

    const stress = parseInt(
      phoneNode?.stress?.['#text']
      ?? phoneNode?.stress
      ?? phoneNode?.['@_stress']
      ?? '0',
      10,
    ) || 0;

    const dpMessage = parseInt(
      phoneNode?.dp_message?.['#text']
      ?? phoneNode?.dp_message
      ?? phoneNode?.['@_dp_message']
      ?? '0',
      10,
    ) || 0;

    const errorLabel = getDpLabel(dpMessage);
    const correct = dpMessage === 0;

    // 用户实际发音：当 dp_message !== 0 时，content 可能反映用户的错误发音
    // 在讯飞 ISE 中，phone content 始终是标准音标
    // 用户发音差异通过 dp_message 和 total_score 体现
    const user = standard;

    return {
      standard: String(standard).trim(),
      user,
      score: rawScore,
      stress,
      correct,
      errorLabel,
    };
  }

  // ========== 正则 fallback：音节提取 ==========

  /** 正则提取 syll 节点（fallback） */
  private static regexExtractSylls(wordInner: string): ParsedSyll[] {
    const syllRegex = /<syll[^>]*content="([^"]*)"[^>]*>([\s\S]*?)<\/syll>|<syll([^/>]*)\/>/g;
    const sylls: ParsedSyll[] = [];
    let m: RegExpExecArray | null;

    while ((m = syllRegex.exec(wordInner)) !== null) {
      if (m[3] !== undefined) {
        // 自闭合
        const content = XFXmlParser.extractAttr(m[3], 'content');
        const score = XFXmlParser.parseFloatSafe(XFXmlParser.extractAttr(m[3], 'total_score'));
        const dpMsg = parseInt(XFXmlParser.extractAttr(m[3], 'dp_message') || '0', 10) || 0;
        sylls.push({
          content,
          score,
          initial: '',
          final: '',
          tone: 1,
          initialCorrect: true,
          finalCorrect: true,
          toneCorrect: true,
          errorLabel: getDpLabel(dpMsg),
        });
      } else if (m[1] !== undefined) {
        // 有子元素
        const content = m[1];
        const inner = m[2];
        const score = XFXmlParser.extractChildNumeric(inner, 'total_score');
        const dpMsg = XFXmlParser.extractChildNumeric(inner, 'dp_message');
        const phoneContent = XFXmlParser.extractChild(inner, 'phone');
        const toneContent = XFXmlParser.extractChild(inner, 'tone');
        const phoneDp = XFXmlParser.extractChildNumeric(inner, 'dp_message'); // tone's dp

        sylls.push({
          content,
          score,
          initial: phoneContent,
          final: toneContent.replace(/[0-9]/g, ''),
          tone: parseInt((toneContent.match(/([0-9])/) || ['1'])[1], 10) || 1,
          initialCorrect: phoneDp === 0,
          finalCorrect: phoneDp === 0,
          toneCorrect: phoneDp === 0,
          errorLabel: getDpLabel(dpMsg),
        });
      }
    }

    return sylls;
  }

  /** 正则提取 phone 节点（fallback） */
  private static regexExtractPhones(wordInner: string): ParsedPhone[] {
    const phoneRegex = /<phone[^>]*content="([^"]*)"[^/>]*\/>/g;
    const phones: ParsedPhone[] = [];
    let m: RegExpExecArray | null;

    while ((m = phoneRegex.exec(wordInner)) !== null) {
      const attrStr = m[0];
      const content = XFXmlParser.extractAttr(attrStr, 'content');
      const score = XFXmlParser.parseFloatSafe(XFXmlParser.extractAttr(attrStr, 'total_score'));
      const stress = parseInt(XFXmlParser.extractAttr(attrStr, 'stress') || '0', 10) || 0;
      const dpMsg = parseInt(XFXmlParser.extractAttr(attrStr, 'dp_message') || '0', 10) || 0;

      phones.push({
        standard: content,
        user: content,
        score,
        stress,
        correct: dpMsg === 0,
        errorLabel: getDpLabel(dpMsg),
      });
    }

    return phones;
  }

  // ========== 公共工具函数 ==========

  /** 安全提取浮点数 */
  private static parseFloatSafe(value: any): number {
    if (value === undefined || value === null) return 0;
    if (typeof value === 'number') return value;
    if (typeof value === 'object' && value['#text'] !== undefined) {
      const num = parseFloat(value['#text']);
      return isNaN(num) ? 0 : num;
    }
    const num = parseFloat(String(value));
    return isNaN(num) ? 0 : num;
  }

  /** 将单词分数归一化到 0-100 */
  private static normalizeWordScore(score: number, wasNormalized: boolean): number {
    if (!wasNormalized) return score;
    // 如果维度分已归一化，单词分数也需要同步缩放
    // 单词分通常和维度分同单位
    if (score <= 10 && score > 0) {
      // 判断分制：score ≤ 5 → 5分制, 5 < score ≤ 10 → 10分制
      if (score > 5) {
        return Math.round(score * 10);
      }
      return Math.round(score * 20);
    }
    return score;
  }

  /** 从属性字符串中提取值：<word attr="value"/> */
  private static extractAttr(attrStr: string, attrName: string): string {
    const re = new RegExp(`${attrName}\\s*=\\s*"([^"]*)"`, 'i');
    const m = attrStr.match(re);
    return m ? m[1] : '';
  }

  /** 从子元素内容中提取标签文本 */
  private static extractChild(inner: string, tag: string): string {
    const re = new RegExp(`<${tag}[^>]*>(.*?)</${tag}>`, 'i');
    const m = inner.match(re);
    return m ? m[1].trim() : '';
  }

  /** 从子元素内容中提取数值 */
  private static extractChildNumeric(inner: string, tag: string): number {
    const v = XFXmlParser.extractChild(inner, tag);
    const num = parseFloat(v);
    return isNaN(num) ? 0 : num;
  }

  /** 空结果（安全默认值），可附带错误说明 */
  private static emptyResult(error?: string): ParsedIseResult {
    return {
      totalScore: 0,
      dimensions: {
        total_score: 0,
        accuracy_score: 0,
        fluency_score: 0,
        integrity_score: 0,
      },
      words: [],
      detectedLanguage: 'unknown',
      scoreNormalized: false,
      rawParsed: {},
      ...(error ? { error } : {}),
    };
  }
}
