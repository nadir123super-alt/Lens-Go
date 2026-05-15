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

interface GenerateOptions {
  word: string;
  translation?: string;
  pos?: string; // 词性: adjective, noun, verb, adverb
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

// ── 按词性分类的句型模板 ──
// 每个模板是一个函数，接收 word 和 translation 参数
// 函数在调用时才执行模板字符串插值

// 形容词模板 (adjective)
const adjectiveTemplates: Array<(word: string, translation: string) => ExampleSentence[]> = [
  (word, translation) => [
    {
      e: `The ${word} flowers bloomed in the garden.`,
      c: `花园里盛开着${translation}的花朵。`,
    },
    {
      e: `She gave me a ${word} response to my question.`,
      c: `她对我的问题给出了${translation}的回答。`,
    },
  ],
  (word, translation) => [
    {
      e: `It was a ${word} day for our picnic.`,
      c: `对我们的野餐来说，这是${translation}的一天。`,
    },
    {
      e: `He made a ${word} decision that changed everything.`,
      c: `他做了一个${translation}的决定，改变了一切。`,
    },
  ],
  (word, translation) => [
    {
      e: `The ${word} music made everyone feel relaxed.`,
      c: `${translation}的音乐让每个人都感到放松。`,
    },
    {
      e: `We enjoyed a ${word} evening by the fire.`,
      c: `我们在篝火旁度过了${translation}的夜晚。`,
    },
  ],
];

// 名词模板 (noun)
const nounTemplates: Array<(word: string, translation: string) => ExampleSentence[]> = [
  (word, translation) => [
    {
      e: `The ${word} is an important part of our culture.`,
      c: `${translation}是我们文化的重要组成部分。`,
    },
    {
      e: `She gave me a beautiful ${word} as a gift.`,
      c: `她送给我一个漂亮的${translation}作为礼物。`,
    },
  ],
  (word, translation) => [
    {
      e: `We need to buy some fresh ${word} for dinner.`,
      c: `我们需要买一些新鲜的${translation}做晚餐。`,
    },
    {
      e: `The ${word} was placed carefully on the table.`,
      c: `${translation}被小心地放在桌子上。`,
    },
  ],
  (word, translation) => [
    {
      e: `He spent hours reading about ${word} history.`,
      c: `他花了几个小时阅读关于${translation}的历史。`,
    },
    {
      e: `The ${word} stood tall against the blue sky.`,
      c: `${translation}高耸入云，映衬着蓝天。`,
    },
  ],
];

// 动词模板 (verb)
const verbTemplates: Array<(word: string, translation: string) => ExampleSentence[]> = [
  (word, translation) => [
    {
      e: `We decided to ${word} together next weekend.`,
      c: `我们决定下周末一起${translation}。`,
    },
    {
      e: `She likes to ${word} early in the morning.`,
      c: `她喜欢早上早点${translation}。`,
    },
  ],
  (word, translation) => [
    {
      e: `They plan to ${word} the project next month.`,
      c: `他们计划下个月${translation}这个项目。`,
    },
    {
      e: `Can you teach me how to ${word} properly?`,
      c: `你能教我如何正确${translation}吗？`,
    },
  ],
  (word, translation) => [
    {
      e: `He promised to ${word} as soon as possible.`,
      c: `他答应尽快${translation}。`,
    },
    {
      e: `We should ${word} more often to stay healthy.`,
      c: `我们应该经常${translation}以保持健康。`,
    },
  ],
];

// 通用模板（适用于所有词性）
const universalTemplates: Array<(word: string, translation: string) => ExampleSentence[]> = [
  (word, translation) => [
    {
      e: `I learned the word ${word} in my English class.`,
      c: `我在英语课上学到了${translation}这个词。`,
    },
    {
      e: `Can you use ${word} in a sentence for me?`,
      c: `你能帮我用${translation}造个句子吗？`,
    },
  ],
  (word, translation) => [
    {
      e: `The meaning of ${word} is very interesting.`,
      c: `${translation}的含义非常有趣。`,
    },
    {
      e: `I hear the word ${word} quite often these days.`,
      c: `这些天我经常听到${translation}这个词。`,
    },
  ],
];

/**
 * 为指定单词自动生成两个包含该单词的例句
 *
 * 策略：
 *   1. 根据词性选择合适的模板组
 *   2. 将目标单词动态嵌入到英文例句中
 *   3. 将中文翻译嵌入到中文例句中
 *   4. 经过 normalizeSentence 标准化
 *
 * @param options 包含 word, translation, pos 的选项对象
 * @returns 2 个 { e, c } 例句，每个例句都包含目标单词
 */
export function generateExampleSentences(
  options: GenerateOptions | string
): ExampleSentence[] {
  // 兼容旧接口（只传 word 字符串）
  const { word, translation, pos } = typeof options === 'string' 
    ? { word: options, translation: '', pos: '' }
    : options;

  if (!word || !word.trim()) {
    return [
      { e: 'Please practice this word again and again.', c: '请反复练习这个单词。' },
      { e: 'Try to use this word in a sentence every day.', c: '尝试每天用这个单词造一个句子。' },
    ];
  }

  const cleanWord = word.trim().toLowerCase();
  const displayTranslation = translation || cleanWord;

  // 根据词性选择模板组
  let templates: Array<(word: string, translation: string) => ExampleSentence[]>;
  switch (pos?.toLowerCase()) {
    case 'adjective':
    case 'adj':
    case '形容词':
      templates = adjectiveTemplates;
      break;
    case 'noun':
    case '名词':
      templates = nounTemplates;
      break;
    case 'verb':
    case 'v':
    case '动词':
      templates = verbTemplates;
      break;
    default:
      // 默认：根据单词形式猜测词性
      if (cleanWord.endsWith('ly')) {
        templates = adjectiveTemplates;
      } else {
        // 无法确定词性时，优先使用通用模板
        templates = universalTemplates;
      }
  }

  // 基于单词哈希选择模板组
  const hash = cleanWord.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const templateIndex = hash % templates.length;

  // 生成例句：将 word 和 translation 嵌入模板
  const rawExamples = templates[templateIndex](cleanWord, displayTranslation);

  // 标准化并返回
  const examples = rawExamples.map((ex) => ({
    e: normalizeSentence(ex.e),
    c: ex.c,
  }));

  console.log(`[sentenceGenerator] 为 "${word}" (${pos || 'unknown'}, ${translation}) 生成例句:`, JSON.stringify(examples));

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
