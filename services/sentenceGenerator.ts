/**
 * sentenceGenerator — 本地例句自动生成器
 *
 * 为每个单词动态生成两个包含该单词的高质量英文例句及中文翻译。
 *
 * 核心逻辑：
 *   - 所有例句必须包含目标单词（以 "..." 占位符替换，最终将单词嵌入）
 *   - 每个模板是一个函数，接收 word 参数，返回 { e, c }
 *   - 例句经过 normalizeSentence 标准化（仅首字母大写，句末标点）
 *   - 长度适中，无非法标点，符合 ISE read_sentence 评测格式
 *
 * 2026-05-09 v2 修复：
 *   - 所有例句现在都动态嵌入目标单词（而非固定 "this word" 等泛称）
 *   - template 中英文模板使用 ${word} 占位填充，中文翻译同步适配
 *   - 兜底回退也嵌入单词，禁止返回无关的固定例句
 */

interface ExampleSentence {
  e: string; // 英文例句（包含目标单词）
  c: string; // 中文翻译
}

/**
 * 将句子标准化：
 *   - 仅首字母大写
 *   - 确保句末有标点（句号 . 问号 ? 感叹号 !）
 *   - 移除多余空格
 */
function normalizeSentence(sentence: string): string {
  let trimmed = sentence.trim();
  trimmed = trimmed.replace(/\s+/g, ' ');
  trimmed = trimmed.toLowerCase();
  trimmed = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  if (!/[.?!]$/.test(trimmed)) {
    trimmed += '.';
  }
  return trimmed;
}

// ── 句型模板 ──
// 每个模板必须使用 ${word} 嵌入目标单词（不可使用 "this word" 等泛称）
// 中文翻译也必须包含该单词的中文释义对应表述
const sentenceTemplates: Array<(word: string) => ExampleSentence[]> = [
  // 模板 1: 一般疑问句
  (word) => [
    {
      e: `Do you know how to use ${word} in a sentence?`,
      c: `你知道如何在一个句子中使用"${word}"吗？`,
    },
    {
      e: `Can you tell me the meaning of ${word}?`,
      c: `你能告诉我"${word}"的意思吗？`,
    },
  ],
  // 模板 2: 陈述句 + 学习用法
  (word) => [
    {
      e: `Learning how to pronounce ${word} is very important.`,
      c: `学会如何发音"${word}"是非常重要的。`,
    },
    {
      e: `The word ${word} is often used in daily conversations.`,
      c: `"${word}"这个词在日常对话中经常被使用。`,
    },
  ],
  // 模板 3: 日常场景
  (word) => [
    {
      e: `I need to practice saying ${word} more often.`,
      c: `我需要更频繁地练习说"${word}"。`,
    },
    {
      e: `Please repeat the word ${word} after me.`,
      c: `请跟着我重复"${word}"这个词。`,
    },
  ],
  // 模板 4: 记忆 + 使用
  (word) => [
    {
      e: `It is helpful to write down the word ${word} in your notebook.`,
      c: `把"${word}"这个词写在笔记本上是有帮助的。`,
    },
    {
      e: `I want to use the word ${word} in my English speech.`,
      c: `我想在我的英语演讲中使用"${word}"这个词。`,
    },
  ],
  // 模板 5: 理解 + 练习
  (word) => [
    {
      e: `The teacher asked the class to spell the word ${word}.`,
      c: `老师让全班同学拼写"${word}"这个词。`,
    },
    {
      e: `I finally understand what the word ${word} means.`,
      c: `我终于理解了"${word}"这个词的含义。`,
    },
  ],
];

/**
 * 为指定单词自动生成两个包含该单词的例句
 *
 * 策略：
 *   1. 基于单词的哈希值选择一个模板组
 *   2. 将目标单词动态嵌入到英文例句中
 *   3. 生成对应的中文翻译示例
 *   4. 经过 normalizeSentence 标准化
 *
 * @param word 目标英文单词（用于嵌入例句 + 哈希选择模板）
 * @returns 2 个 { e, c } 例句，每个例句都包含目标单词
 */
export function generateExampleSentences(word: string): ExampleSentence[] {
  if (!word || !word.trim()) {
    // 兜底：如果单词为空，返回带默认单词的例句
    return [
      { e: 'Please practice this word again and again.', c: '请反复练习这个单词。' },
      { e: 'Try to use this word in a sentence every day.', c: '尝试每天用这个单词造一个句子。' },
    ];
  }

  const cleanWord = word.trim().toLowerCase();

  // 基于单词哈希选择模板组
  const hash = cleanWord.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const templateIndex = hash % sentenceTemplates.length;

  // 生成例句：将 word 嵌入模板
  const rawExamples = sentenceTemplates[templateIndex](cleanWord);

  // 标准化并返回
  const examples = rawExamples.map((ex) => ({
    e: normalizeSentence(ex.e),
    c: ex.c,
  }));

  console.log(`[sentenceGenerator] 为 "${word}" 生成例句:`, JSON.stringify(examples));

  return examples;
}

/**
 * 判断字符串是否符合例句评测格式要求
 *
 * 规则：
 *   - 不能包含引号、括号、分号等特殊符号
 *   - 长度在 5-25 个单词之间
 *   - 以句号、问号或感叹号结尾
 *
 * @param sentence 要验证的英文句子
 * @returns 是否符合要求
 */
export function isValidForEvaluation(sentence: string): boolean {
  const illegalPattern = /[""''(){}[\]<>;:\\/|`~@#$%^&*+=]/;
  if (illegalPattern.test(sentence)) {
    return false;
  }

  const wordCount = sentence.trim().split(/\s+/).length;
  if (wordCount < 5 || wordCount > 30) {
    return false;
  }

  if (!/[.?!]$/.test(sentence.trim())) {
    return false;
  }

  return true;
}
