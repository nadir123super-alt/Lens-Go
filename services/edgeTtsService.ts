/**
 * Edge TTS 服务 v7 - 情感化 + 自然语调语音合成
 *
 * 核心特性：
 * 1. 完美兼容 Expo Go - 只需要 HTTP 请求
 * 2. 神经网络音色 - 地道 native speaker 发音
 * 3. 情感化朗读 - 使用 Edge TTS <mstts:express-as> SSML 风格标签
 * 4. 智能情绪检测 - 根据文本内容、标点、关键词自动匹配情感
 * 5. 自然语调起伏 - 句子内音高(pitch)动态变化，模拟真人说话
 * 6. 分层停顿系统 - 不同语法边界使用不同长度的停顿
 * 7. 关键词重读 - 使用 <emphasis> 标签突出重要词汇
 * 8. 中英文分离 - 各自使用最佳音色
 * 9. 无冷启动 - Serverless 函数，即开即用
 *
 * 音色配置：
 * - 中文: zh-CN-XiaoxiaoNeural（晓晓，活泼女声）
 * - 英文: en-US-EmmaMultilingualNeural（Emma，多语言神经网络）
 *
 * 情感风格支持（Edge TTS <mstts:express-as>）：
 * - 英文 (en-US-JennyNeural): cheerful, sad, angry, friendly, whispering, excited
 * - 中文 (zh-CN-XiaoxiaoNeural): cheerful, sad, angry, friendly, disgruntled, calm
 *
 * 自然语调特性：
 * - 陈述句末尾降调（pitch -4Hz）
 * - 疑问句末尾升调（pitch +6Hz）
 * - 列举项先升后降
 * - 从句/短语边界 200ms 停顿
 * - 句间 400ms 停顿
 * - 关键词 <emphasis level="moderate"> 重读
 * - 长句中间语速微调 +3% 保持流畅
 */

import { Audio } from 'expo-av';
import { getSpeechRate } from './speechSettingsService';

// ================= 配置 =================
const TTS_API_URL = 'https://cqpszvmritgldvzhlbds.supabase.co/functions/v1/tts';

// ====== 情感风格定义 ======
export type EmotionStyle = 'normal' | 'cheerful' | 'sad' | 'angry' | 'friendly' | 'whispering' | 'excited' | 'calm' | 'disgruntled';

interface EmotionConfig {
  style: EmotionStyle;
  degree: number;       // styledegree 0.01~2.0
  rate: string;         // 语速调整
  pitch: string;        // 音调调整
  label: string;        // 中文描述
}

// 英文情感配置（基于 en-US-JennyNeural 支持的风格）
const EN_EMOTION_MAP: Record<string, EmotionConfig> = {
  excited:   { style: 'excited',    degree: 1.5, rate: '+8%',  pitch: '+12Hz', label: '兴奋' },
  cheerful:  { style: 'cheerful',   degree: 1.2, rate: '+5%',  pitch: '+8Hz',  label: '愉快' },
  friendly:  { style: 'friendly',   degree: 1.0, rate: '+0%',  pitch: '+4Hz',  label: '友好' },
  questioning:{style: 'friendly',   degree: 0.8, rate: '-3%',  pitch: '+6Hz',  label: '疑问' },
  sad:       { style: 'sad',        degree: 1.0, rate: '-10%', pitch: '-4Hz',  label: '悲伤' },
  angry:     { style: 'angry',      degree: 1.2, rate: '+10%', pitch: '+15Hz', label: '生气' },
  whispering:{ style: 'whispering', degree: 1.0, rate: '-15%', pitch: '-6Hz',  label: '低语' },
  calm:      { style: 'friendly',   degree: 0.5, rate: '-5%',  pitch: '+2Hz',  label: '平静' },
  normal:    { style: 'friendly',   degree: 0.6, rate: '-8%',  pitch: '+2Hz',  label: '正常' },
};

// 中文情感配置（基于 zh-CN-XiaoxiaoNeural 支持的风格）
const ZH_EMOTION_MAP: Record<string, EmotionConfig> = {
  excited:   { style: 'cheerful',    degree: 1.5, rate: '+8%',  pitch: '+10Hz', label: '兴奋' },
  cheerful:  { style: 'cheerful',    degree: 1.2, rate: '+5%',  pitch: '+6Hz',  label: '愉快' },
  friendly:  { style: 'friendly',    degree: 1.0, rate: '+0%',  pitch: '+3Hz',  label: '友好' },
  questioning:{style: 'friendly',    degree: 0.8, rate: '-5%',  pitch: '+5Hz',  label: '疑问' },
  sad:       { style: 'sad',         degree: 1.0, rate: '-10%', pitch: '-3Hz',  label: '悲伤' },
  angry:     { style: 'angry',       degree: 1.2, rate: '+12%', pitch: '+12Hz', label: '生气' },
  disgruntled:{style: 'disgruntled', degree: 1.0, rate: '-5%',  pitch: '+0Hz',  label: '不满' },
  calm:      { style: 'calm',        degree: 1.0, rate: '-8%',  pitch: '+0Hz',  label: '平静' },
  normal:    { style: 'friendly',    degree: 0.5, rate: '-5%',  pitch: '+0Hz',  label: '正常' },
};

interface TtsOptions {
  text: string;
  language?: 'en' | 'zh';
  emotion?: EmotionStyle;
  onStart?: () => void;
  onDone?: () => void;
  onError?: (error: any) => void;
  onProgress?: (charIndex: number) => void;
}

interface TtsVoice {
  name: string;
  voice: string;
  language: string;
}

const VOICES: Record<string, string> = {
  zh: 'zh-CN-XiaoxiaoNeural',
  en: 'en-US-EmmaMultilingualNeural',
};

class EdgeTtsService {
  private sound: Audio.Sound | null = null;
  private isPlaying = false;
  private currentText = '';
  private onDoneCallback: (() => void) | null = null;
  private onProgressCallback: ((charIndex: number) => void) | null = null;
  private progressInterval: ReturnType<typeof setInterval> | null = null;
  private voices: TtsVoice[] = [];
  private audioCache: Map<string, string> = new Map(); // 音频缓存

  /**
   * 将用户设置的语速（0.5-2.0）转换为 Edge TTS 可用的百分比格式
   * 例如：1.0 -> -8%（默认语速），2.0 -> +50%，0.5 -> -50%
   */
  private convertRateToPercentage(baseRate: string): string {
    const userRate = getSpeechRate(); // 获取用户设置的语速（0.5-2.0）
    
    // 解析基础速率，例如 "-8%" -> -8
    let baseValue = -8;
    const match = baseRate.match(/([+-]?\d+)%/);
    if (match) {
      baseValue = parseInt(match[1], 10);
    }
    
    // 计算用户速率相对于默认的比例
    // 用户速率 1.0 意味着保持基础速率不变
    // 用户速率 2.0 意味着更快，我们需要增加正的百分比
    // 用户速率 0.5 意味着更慢，我们需要增加负的百分比
    
    // 计算调整系数：userRate 从 0.5 到 2.0，我们转换为一个调整因子
    // 例如：
    // userRate = 0.5 -> 调整因子 = 0.5（更慢）
    // userRate = 1.0 -> 调整因子 = 1.0（不变）
    // userRate = 2.0 -> 调整因子 = 2.0（更快）
    
    // 为了更自然，我们使用非线性映射
    let adjustedValue: number;
    if (userRate >= 1.0) {
      // 变快：最大 +50%
      const maxIncrease = 50;
      const factor = (userRate - 1.0) / (2.0 - 1.0);
      adjustedValue = baseValue + (maxIncrease * factor);
    } else {
      // 变慢：最小 -50%
      const maxDecrease = -50;
      const factor = (1.0 - userRate) / (1.0 - 0.5);
      adjustedValue = baseValue + (maxDecrease * factor);
    }
    
    // 确保在合理范围内 [-50%, +50%]
    adjustedValue = Math.max(-50, Math.min(50, adjustedValue));
    
    // 格式化为字符串
    return adjustedValue >= 0 ? `+${adjustedValue.toFixed(0)}%` : `${adjustedValue.toFixed(0)}%`;
  }

  /**
   * 文本预处理 v3：自然语调 + 分层停顿 + 关键词重读
   *
   * 模拟真人说话的三大要素：
   * 1. 分层停顿系统 - 不同语法边界不同长度停顿
   * 2. 关键词重读 - 内容词（名词/动词/形容词）加 <emphasis>
   * 3. 语调标记 - 为句子末尾添加 prosody 标签控制升降调
   */
  /**
   * 语气词列表及其对应的情感映射
   * 用于在预处理阶段对语气词进行特殊处理（拖长音、停顿、升降调）
   */
  private readonly interjectionMap: Record<string, { emotion: EmotionStyle; pitch: string; breakTime: string }> = {
    // ===== 惊讶/兴奋 =====
    'wow':       { emotion: 'excited',     pitch: '+8Hz',   breakTime: '300ms' },
    'whoa':      { emotion: 'excited',     pitch: '+6Hz',   breakTime: '250ms' },
    'yay':       { emotion: 'excited',     pitch: '+10Hz',  breakTime: '200ms' },
    'yahoo':     { emotion: 'excited',     pitch: '+10Hz',  breakTime: '200ms' },
    'yippee':    { emotion: 'excited',     pitch: '+10Hz',  breakTime: '200ms' },
    'aha':       { emotion: 'excited',     pitch: '+6Hz',   breakTime: '250ms' },
    'oh':        { emotion: 'excited',     pitch: '+4Hz',   breakTime: '300ms' },
    'ooh':       { emotion: 'excited',     pitch: '+6Hz',   breakTime: '250ms' },
    'ah':        { emotion: 'excited',     pitch: '+4Hz',   breakTime: '250ms' },
    'gosh':      { emotion: 'excited',     pitch: '+6Hz',   breakTime: '250ms' },
    'geez':      { emotion: 'excited',     pitch: '+4Hz',   breakTime: '300ms' },
    'jeez':      { emotion: 'excited',     pitch: '+4Hz',   breakTime: '300ms' },
    'crikey':    { emotion: 'excited',     pitch: '+6Hz',   breakTime: '300ms' },
    'blimey':    { emotion: 'excited',     pitch: '+6Hz',   breakTime: '300ms' },
    'yikes':     { emotion: 'excited',     pitch: '+8Hz',   breakTime: '300ms' },
    'eureka':    { emotion: 'excited',     pitch: '+10Hz',  breakTime: '250ms' },
    'bingo':     { emotion: 'excited',     pitch: '+6Hz',   breakTime: '200ms' },
    'voila':     { emotion: 'excited',     pitch: '+4Hz',   breakTime: '250ms' },
    'bravo':     { emotion: 'excited',     pitch: '+8Hz',   breakTime: '300ms' },
    'hallelujah':{ emotion: 'excited',     pitch: '+10Hz',  breakTime: '350ms' },
    'woohoo':    { emotion: 'excited',     pitch: '+10Hz',  breakTime: '250ms' },
    'wowza':     { emotion: 'excited',     pitch: '+8Hz',   breakTime: '300ms' },
    'wee':       { emotion: 'excited',     pitch: '+8Hz',   breakTime: '200ms' },
    'wah':       { emotion: 'excited',     pitch: '+6Hz',   breakTime: '300ms' },
    'rah':       { emotion: 'excited',     pitch: '+6Hz',   breakTime: '200ms' },
    'ha':        { emotion: 'excited',     pitch: '+6Hz',   breakTime: '200ms' },
    'hehe':      { emotion: 'excited',     pitch: '+4Hz',   breakTime: '200ms' },
    'hurrah':    { emotion: 'excited',     pitch: '+8Hz',   breakTime: '250ms' },
    'hurray':    { emotion: 'excited',     pitch: '+8Hz',   breakTime: '250ms' },
    'hooray':    { emotion: 'excited',     pitch: '+8Hz',   breakTime: '250ms' },
    'huzzah':    { emotion: 'excited',     pitch: '+8Hz',   breakTime: '300ms' },
    'tada':      { emotion: 'excited',     pitch: '+10Hz',  breakTime: '200ms' },
    // ===== 思考/犹豫 =====
    'well':      { emotion: 'calm',        pitch: '-2Hz',   breakTime: '400ms' },
    'hmm':       { emotion: 'calm',        pitch: '-3Hz',   breakTime: '500ms' },
    'um':        { emotion: 'calm',        pitch: '-2Hz',   breakTime: '400ms' },
    'uh':        { emotion: 'calm',        pitch: '-2Hz',   breakTime: '350ms' },
    'er':        { emotion: 'calm',        pitch: '-2Hz',   breakTime: '300ms' },
    'meh':       { emotion: 'calm',        pitch: '-3Hz',   breakTime: '300ms' },
    'huh':       { emotion: 'calm',        pitch: '+2Hz',   breakTime: '350ms' },
    'eh':        { emotion: 'calm',        pitch: '+2Hz',   breakTime: '300ms' },
    // ===== 肯定/认同 =====
    'uh-huh':    { emotion: 'friendly',    pitch: '+2Hz',   breakTime: '200ms' },
    'mm-hmm':    { emotion: 'friendly',    pitch: '+2Hz',   breakTime: '200ms' },
    'yeah':      { emotion: 'friendly',    pitch: '+3Hz',   breakTime: '200ms' },
    'yep':       { emotion: 'friendly',    pitch: '+3Hz',   breakTime: '150ms' },
    'okay':      { emotion: 'friendly',    pitch: '+2Hz',   breakTime: '200ms' },
    'alright':   { emotion: 'friendly',    pitch: '+2Hz',   breakTime: '250ms' },
    'ta':        { emotion: 'friendly',    pitch: '+2Hz',   breakTime: '150ms' },
    'cheers':    { emotion: 'friendly',    pitch: '+3Hz',   breakTime: '200ms' },
    'amen':      { emotion: 'friendly',    pitch: '+2Hz',   breakTime: '300ms' },
    // ===== 否定/怀疑 =====
    'nah':       { emotion: 'calm',        pitch: '-3Hz',   breakTime: '200ms' },
    'nope':      { emotion: 'calm',        pitch: '-3Hz',   breakTime: '150ms' },
    'uh-uh':     { emotion: 'calm',        pitch: '-4Hz',   breakTime: '200ms' },
    'duh':       { emotion: 'calm',        pitch: '-3Hz',   breakTime: '250ms' },
    // ===== 疼痛/意外/厌恶 =====
    'ouch':      { emotion: 'sad',         pitch: '+6Hz',   breakTime: '300ms' },
    'ow':        { emotion: 'sad',         pitch: '+5Hz',   breakTime: '250ms' },
    'oops':      { emotion: 'sad',         pitch: '+4Hz',   breakTime: '300ms' },
    'whoops':    { emotion: 'sad',         pitch: '+4Hz',   breakTime: '300ms' },
    'woops':     { emotion: 'sad',         pitch: '+4Hz',   breakTime: '300ms' },
    'uh-oh':     { emotion: 'sad',         pitch: '+5Hz',   breakTime: '350ms' },
    'alas':      { emotion: 'sad',         pitch: '-4Hz',   breakTime: '400ms' },
    'ugh':       { emotion: 'sad',         pitch: '-5Hz',   breakTime: '400ms' },
    'darn':      { emotion: 'sad',         pitch: '-3Hz',   breakTime: '300ms' },
    'doh':       { emotion: 'sad',         pitch: '-4Hz',   breakTime: '350ms' },
    'phew':      { emotion: 'sad',         pitch: '-5Hz',   breakTime: '400ms' },
    'whew':      { emotion: 'sad',         pitch: '-5Hz',   breakTime: '400ms' },
    'ew':        { emotion: 'sad',         pitch: '-4Hz',   breakTime: '350ms' },
    'eew':       { emotion: 'sad',         pitch: '-4Hz',   breakTime: '350ms' },
    'ick':       { emotion: 'sad',         pitch: '-3Hz',   breakTime: '300ms' },
    'yuck':      { emotion: 'sad',         pitch: '-4Hz',   breakTime: '350ms' },
    'yuk':       { emotion: 'sad',         pitch: '-4Hz',   breakTime: '350ms' },
    'bleh':      { emotion: 'sad',         pitch: '-3Hz',   breakTime: '300ms' },
    'boo':       { emotion: 'sad',         pitch: '-3Hz',   breakTime: '300ms' },
    'oy':        { emotion: 'sad',         pitch: '+3Hz',   breakTime: '300ms' },
    'oi':        { emotion: 'sad',         pitch: '+3Hz',   breakTime: '300ms' },
    'aw':        { emotion: 'friendly',    pitch: '+3Hz',   breakTime: '300ms' },
    'aww':       { emotion: 'friendly',    pitch: '+3Hz',   breakTime: '350ms' },
    'eek':       { emotion: 'excited',     pitch: '+8Hz',   breakTime: '300ms' },
    'gah':       { emotion: 'sad',         pitch: '-3Hz',   breakTime: '300ms' },
    'grr':       { emotion: 'angry',       pitch: '-4Hz',   breakTime: '350ms' },
    'hmph':      { emotion: 'angry',       pitch: '-3Hz',   breakTime: '350ms' },
    'mm':        { emotion: 'calm',        pitch: '-2Hz',   breakTime: '400ms' },
    'mmm':       { emotion: 'friendly',    pitch: '+3Hz',   breakTime: '350ms' },
    'oof':       { emotion: 'sad',         pitch: '+4Hz',   breakTime: '300ms' },
    'urgh':      { emotion: 'sad',         pitch: '-5Hz',   breakTime: '400ms' },
    'yow':       { emotion: 'sad',         pitch: '+6Hz',   breakTime: '300ms' },
    // ===== 问候/社交 =====
    'hey':       { emotion: 'friendly',    pitch: '+5Hz',   breakTime: '200ms' },
    'hi':        { emotion: 'friendly',    pitch: '+4Hz',   breakTime: '150ms' },
    'hello':     { emotion: 'friendly',    pitch: '+3Hz',   breakTime: '200ms' },
    'bye':       { emotion: 'friendly',    pitch: '-2Hz',   breakTime: '250ms' },
    'goodbye':   { emotion: 'friendly',    pitch: '-2Hz',   breakTime: '300ms' },
    'psst':      { emotion: 'whispering',  pitch: '-6Hz',   breakTime: '300ms' },
    'shh':       { emotion: 'whispering',  pitch: '-8Hz',   breakTime: '400ms' },
    'ahem':      { emotion: 'friendly',    pitch: '+2Hz',   breakTime: '300ms' },
    'yo':        { emotion: 'friendly',    pitch: '+5Hz',   breakTime: '200ms' },
    'sup':       { emotion: 'friendly',    pitch: '+3Hz',   breakTime: '200ms' },
    'yoo-hoo':   { emotion: 'friendly',    pitch: '+6Hz',   breakTime: '250ms' },
    'shoo':      { emotion: 'friendly',    pitch: '+3Hz',   breakTime: '200ms' },
    'c\'mon':    { emotion: 'friendly',    pitch: '+3Hz',   breakTime: '200ms' },
    // ===== 其他 =====
    'brr':       { emotion: 'sad',         pitch: '-6Hz',   breakTime: '400ms' },
    'tsk':       { emotion: 'calm',        pitch: '-4Hz',   breakTime: '300ms' },
    'tut':       { emotion: 'calm',        pitch: '-4Hz',   breakTime: '300ms' },
    'zzz':       { emotion: 'calm',        pitch: '-8Hz',   breakTime: '500ms' },
    // ===== 中文语气词 =====
    '哦':        { emotion: 'excited',     pitch: '+4Hz',   breakTime: '250ms' },
    '噢':        { emotion: 'excited',     pitch: '+4Hz',   breakTime: '250ms' },
    '哇':        { emotion: 'excited',     pitch: '+8Hz',   breakTime: '300ms' },
    '嗯':        { emotion: 'calm',        pitch: '-2Hz',   breakTime: '400ms' },
    '呃':        { emotion: 'calm',        pitch: '-2Hz',   breakTime: '350ms' },
    '啊':        { emotion: 'excited',     pitch: '+5Hz',   breakTime: '250ms' },
    '哎呀':      { emotion: 'excited',     pitch: '+6Hz',   breakTime: '300ms' },
    '哎哟':      { emotion: 'sad',         pitch: '+5Hz',   breakTime: '300ms' },
    '唉':        { emotion: 'sad',         pitch: '-4Hz',   breakTime: '400ms' },
    '喂':        { emotion: 'friendly',    pitch: '+5Hz',   breakTime: '200ms' },
    '嗨':        { emotion: 'friendly',    pitch: '+4Hz',   breakTime: '200ms' },
    '哈':        { emotion: 'excited',     pitch: '+6Hz',   breakTime: '200ms' },
    '呵呵':      { emotion: 'friendly',    pitch: '+2Hz',   breakTime: '200ms' },
    '哈哈':      { emotion: 'excited',     pitch: '+8Hz',   breakTime: '250ms' },
  };

  /**
   * 预处理文本中的语气词，添加自然的停顿和语调标记
   * - 语气词后添加自然停顿
   * - 语气词使用 prosody 标签调整音高
   * - 语气词后跟逗号时，停顿缩短
   */
  private preprocessInterjections(text: string): string {
    let processed = text;

    // 按单词边界匹配语气词（英文语气词）
    for (const [word, config] of Object.entries(this.interjectionMap)) {
      // 只匹配英文语气词（纯字母）
      if (/^[a-zA-Z-]+$/.test(word)) {
        // 匹配完整单词（大小写不敏感），后面可能跟标点
        const pattern = new RegExp(
          `\\b(${word.replace(/-/g, '\\-')})([\\s,;:.!?，；：。！？]|$)`,
          'gi'
        );
        processed = processed.replace(pattern, (match, interj, punct) => {
          // 如果语气词后紧跟逗号，停顿缩短
          const isFollowedByComma = /^[,，]/.test(punct);
          const breakTime = isFollowedByComma ? '150ms' : config.breakTime;
          return `<prosody pitch="${config.pitch}">${interj}</prosody><break time="${breakTime}"/>${punct}`;
        });
      }
    }

    // 处理中文语气词（单字或双字，出现在句首或独立存在）
    const zhInterjectionPattern = new RegExp(
      `([\\s，。！？；：]|^)(${Object.keys(this.interjectionMap)
        .filter(k => /[\u4e00-\u9fff]/.test(k))
        .sort((a, b) => b.length - a.length) // 长词优先匹配
        .join('|')})([\\s，。！？；：]|$)`,
      'g'
    );
    processed = processed.replace(zhInterjectionPattern, (match, before, interj, after) => {
      const config = this.interjectionMap[interj];
      if (!config) return match;
      const breakTime = /^[，,]/.test(after) ? '150ms' : config.breakTime;
      return `${before}<prosody pitch="${config.pitch}">${interj}</prosody><break time="${breakTime}"/>${after}`;
    });

    return processed;
  }

  private preprocessTextWithBreaks(text: string, language: 'en' | 'zh'): string {
    let processed = text;

    if (language === 'en') {
      // ===== 英文处理 =====

      // Step 1: 保护已存在的 SSML 标签
      const placeholders: string[] = [];
      let phIndex = 0;
      processed = processed.replace(/<[^>]+>/g, (match) => {
        const ph = `__SSML_PH_${phIndex}__`;
        placeholders[phIndex] = match;
        phIndex++;
        return ph;
      });

      // Step 2: 语气词预处理（在分层停顿之前，避免语气词被标点规则干扰）
      processed = this.preprocessInterjections(processed);

      // Step 3: 分层停顿
      // 句号/问号/感叹号 → 800ms（句末长停顿，让句子之间有呼吸感）
      processed = processed.replace(/\.(?!\s*[)'"\]]|$)/g, '.<break time="800ms"/>');
      processed = processed.replace(/\?(?!\s*[)'"\]]|$)/g, '?<break time="800ms"/>');
      processed = processed.replace(/!(?!\s*[)'"\]]|$)/g, '!<break time="800ms"/>');
      // 冒号/分号 → 250ms（中等停顿）
      processed = processed.replace(/;(?![^<]*>)/g, ';<break time="250ms"/>');
      processed = processed.replace(/:(?![^<]*>)/g, ':<break time="250ms"/>');
      // 逗号 → 150ms（短停顿）
      processed = processed.replace(/,(?![^<]*>)/g, ',<break time="150ms"/>');
      // 破折号 → 200ms
      processed = processed.replace(/—(?![^<]*>)/g, '<break time="200ms"/>');

      // Step 4: 关键词重读 - 对句子中的内容词（名词/动词/形容词/副词）加 prosody 强调
      // 注意：Edge TTS 不支持 <emphasis> 标签，改用 <prosody> 实现重读效果
      // 使用常见的高信息量词汇列表
      const emphasisWords = [
        // 形容词（描述性）
        'amazing', 'beautiful', 'brilliant', 'crucial', 'difficult', 'essential',
        'fantastic', 'great', 'huge', 'important', 'incredible', 'key',
        'major', 'perfect', 'significant', 'special', 'terrible', 'unique',
        'vital', 'wonderful', 'excellent', 'horrible', 'lovely', 'massive',
        'necessary', 'obvious', 'powerful', 'remarkable', 'strong', 'useful',
        // 动词（动作性）
        'love', 'hate', 'need', 'want', 'must', 'can\'t', 'won\'t',
        'achieve', 'believe', 'change', 'create', 'decide', 'discover',
        'ensure', 'explain', 'guarantee', 'improve', 'increase', 'learn',
        'master', 'practice', 'prevent', 'prove', 'realize', 'reduce',
        'remember', 'solve', 'succeed', 'transform', 'understand',
        // 名词（核心概念）
        'secret', 'key', 'rule', 'tip', 'trick', 'truth', 'fact',
        'problem', 'solution', 'result', 'reason', 'goal', 'dream',
        'challenge', 'opportunity', 'advantage', 'benefit', 'difference',
        // 副词（强调程度）
        'absolutely', 'completely', 'definitely', 'entirely', 'extremely',
        'fully', 'highly', 'perfectly', 'really', 'strongly', 'totally',
        'truly', 'very', 'always', 'never', 'always', 'certainly',
      ];
      
      // 构建正则：匹配完整单词（大小写不敏感）
      const emphasisPattern = new RegExp(
        `\\b(${emphasisWords.join('|')})\\b`,
        'gi'
      );
      // 使用 prosody 替代 emphasis（Edge TTS 不支持 emphasis 标签）
      processed = processed.replace(emphasisPattern, '<prosody pitch="+4Hz" rate="-5%">$1</prosody>');

      // Step 5: 恢复 SSML 标签
      processed = processed.replace(/__SSML_PH_(\d+)__/g, (_, idx) => placeholders[parseInt(idx)]);

    } else {
      // ===== 中文处理 =====
      
      // 保护已存在的 SSML 标签
      const placeholders: string[] = [];
      let phIndex = 0;
      processed = processed.replace(/<[^>]+>/g, (match) => {
        const ph = `__SSML_PH_${phIndex}__`;
        placeholders[phIndex] = match;
        phIndex++;
        return ph;
      });

      // 语气词预处理
      processed = this.preprocessInterjections(processed);

      // 分层停顿
      // 句号/问号/感叹号 → 800ms（句末长停顿，让句子之间有呼吸感）
      processed = processed.replace(/。(?![^<]*>)/g, '。<break time="800ms"/>');
      processed = processed.replace(/？(?![^<]*>)/g, '？<break time="800ms"/>');
      processed = processed.replace(/！(?![^<]*>)/g, '！<break time="800ms"/>');
      processed = processed.replace(/；(?![^<]*>)/g, '；<break time="250ms"/>');
      processed = processed.replace(/：(?![^<]*>)/g, '：<break time="250ms"/>');
      processed = processed.replace(/，(?![^<]*>)/g, '，<break time="150ms"/>');
      processed = processed.replace(/——(?![^<]*>)/g, '<break time="200ms"/>');

      // 恢复 SSML 标签
      processed = processed.replace(/__SSML_PH_(\d+)__/g, (_, idx) => placeholders[parseInt(idx)]);
    }

    return processed;
  }

  /**
   * 生成完整的 SSML 配置 v3（情感化 + 自然语调）
   *
   * 使用 Edge TTS 的 <mstts:express-as> 标签实现情感化朗读：
   * - 英文: en-US-JennyNeural 支持 cheerful, sad, angry, friendly, whispering, excited
   * - 中文: zh-CN-XiaoxiaoNeural 支持 cheerful, sad, angry, friendly, disgruntled, calm
   *
   * 自然语调增强：
   * - 句子末尾升降调（陈述句降、疑问句升）
   * - 列举项语调变化
   * - 长句分段处理
   *
   * styledegree 控制情感强度：0.01（最弱）~ 2.0（最强）
   */
  private generateSsml(
    text: string,
    voice: string,
    rate: string,
    pitch: string,
    language: 'en' | 'zh',
    emotion: EmotionStyle = 'normal'
  ): string {
    // 获取情感配置
    const emotionMap = language === 'zh' ? ZH_EMOTION_MAP : EN_EMOTION_MAP;
    const emotionConfig = emotionMap[emotion] || emotionMap.normal;

    // 预处理文本（停顿 + 关键词重读）
    let processedText = this.preprocessTextWithBreaks(text, language);

    // ===== 自然语调处理：按句子拆分，为每个句子添加升降调 =====
    if (language === 'en') {
      processedText = this.addEnglishIntonation(processedText, emotionConfig);
    } else {
      processedText = this.addChineseIntonation(processedText, emotionConfig);
    }

    // 构建 SSML（使用 mstts:express-as 情感标签）
    return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="${language === 'zh' ? 'zh-CN' : 'en-US'}">
      <voice name="${voice}">
        <mstts:express-as style="${emotionConfig.style}" styledegree="${emotionConfig.degree}">
          <prosody rate="${rate}" pitch="${pitch}">
            ${processedText}
          </prosody>
        </mstts:express-as>
      </voice>
    </speak>`;
  }

  /**
   * 英文语调处理：为每个句子添加自然的升降调
   *
   * 规则：
   * - 陈述句（句号结尾）：末尾降调 pitch="-4Hz"
   * - 疑问句（问号结尾）：末尾升调 pitch="+6Hz"
   * - 感叹句（感叹号结尾）：末尾升调 pitch="+8Hz"
   * - 长句（超过15词）：中间部分语速微调 +3% 保持流畅
   * - 列举（逗号分隔的短项）：先升后降模式
   */
  private addEnglishIntonation(text: string, emotionConfig: EmotionConfig): string {
    // 保护已存在的 SSML 标签
    const placeholders: string[] = [];
    let phIndex = 0;
    const protectedText = text.replace(/<[^>]+>/g, (match) => {
      const ph = `__SSML_PH_${phIndex}__`;
      placeholders[phIndex] = match;
      phIndex++;
      return ph;
    });

    // 检测文本中是否包含 SSML 占位符（即已有 prosody 标签来自关键词强调）
    // 如果有，则不再用 prosody 包裹整个句子，避免嵌套 prosody 导致 Edge TTS 解析异常
    const hasSsmlPlaceholders = placeholders.length > 0;

    // 按句子拆分（句号、问号、感叹号 + 可选的 break 标签）
    const sentencePattern = /([^.!?]*[.!?])(?:<break[^>]*\/>)?\s*/g;
    let result = '';
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    // 重置正则
    sentencePattern.lastIndex = 0;

    while ((match = sentencePattern.exec(protectedText)) !== null) {
      const sentence = match[1];
      const breakTag = match[0].substring(sentence.length);
      const trimmed = sentence.trim();
      
      if (!trimmed) continue;

      const words = trimmed.split(/\s+/).filter(w => w.length > 0);
      const wordCount = words.length;

      // 判断句子类型
      const endsWithQuestion = trimmed.endsWith('?');
      const endsWithExclamation = trimmed.endsWith('!');
      const endsWithPeriod = trimmed.endsWith('.');

      // 计算句子级别的 pitch 调整
      let sentencePitch = '0Hz';
      if (endsWithQuestion) {
        sentencePitch = '+6Hz';  // 疑问句升调
      } else if (endsWithExclamation) {
        sentencePitch = '+8Hz';  // 感叹句升调
      } else if (endsWithPeriod) {
        sentencePitch = '-4Hz';  // 陈述句降调
      }

      // 如果文本中已有 SSML 标签（关键词强调的 prosody），避免嵌套 prosody
      if (hasSsmlPlaceholders) {
        // 直接输出文本 + 句末停顿，不额外包裹 prosody
        result += trimmed + breakTag;
      } else if (wordCount > 15) {
        // 长句处理：中间部分语速微调
        const third = Math.floor(wordCount / 3);
        const part1 = words.slice(0, third).join(' ');
        const part2 = words.slice(third, wordCount - third).join(' ');
        const part3 = words.slice(wordCount - third).join(' ');

        result += `<prosody pitch="${sentencePitch}">${part1}</prosody> `;
        result += `<prosody rate="+3%" pitch="+2Hz">${part2}</prosody> `;
        result += `<prosody pitch="${sentencePitch}">${part3}</prosody>`;
      } else if (wordCount > 8) {
        // 中等长度句子：分两段
        const half = Math.floor(wordCount / 2);
        const part1 = words.slice(0, half).join(' ');
        const part2 = words.slice(half).join(' ');

        result += `<prosody pitch="+2Hz">${part1}</prosody> `;
        result += `<prosody pitch="${sentencePitch}">${part2}</prosody>`;
      } else {
        // 短句：整体加升降调
        result += `<prosody pitch="${sentencePitch}">${trimmed}</prosody>`;
      }

      // 添加句末停顿
      result += breakTag;
      lastIndex = match.index + match[0].length;
    }

    // 处理剩余文本（没有标点结尾的部分）
    const remaining = protectedText.substring(lastIndex).trim();
    if (remaining) {
      if (hasSsmlPlaceholders) {
        result += remaining;
      } else {
        result += `<prosody pitch="-2Hz">${remaining}</prosody>`;
      }
    }

    // 恢复 SSML 标签
    result = result.replace(/__SSML_PH_(\d+)__/g, (_, idx) => placeholders[parseInt(idx)]);

    return result;
  }

  /**
   * 中文语调处理
   * - 句号结尾：降调 pitch="-3Hz"
   * - 问号结尾：升调 pitch="+5Hz"
   * - 感叹号结尾：升调 pitch="+6Hz"
   * - 长句中间语速微调
   */
  private addChineseIntonation(text: string, emotionConfig: EmotionConfig): string {
    // 保护已存在的 SSML 标签
    const placeholders: string[] = [];
    let phIndex = 0;
    const protectedText = text.replace(/<[^>]+>/g, (match) => {
      const ph = `__SSML_PH_${phIndex}__`;
      placeholders[phIndex] = match;
      phIndex++;
      return ph;
    });

    // 按句子拆分
    const sentencePattern = /([^。？！]*[。？！])(?:<break[^>]*\/>)?\s*/g;
    let result = '';
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    sentencePattern.lastIndex = 0;

    while ((match = sentencePattern.exec(protectedText)) !== null) {
      const sentence = match[1];
      const breakTag = match[0].substring(sentence.length);
      const trimmed = sentence.trim();
      
      if (!trimmed) continue;

      const charCount = trimmed.length;
      const endsWithQuestion = trimmed.endsWith('？');
      const endsWithExclamation = trimmed.endsWith('！');
      const endsWithPeriod = trimmed.endsWith('。');

      let sentencePitch = '0Hz';
      if (endsWithQuestion) {
        sentencePitch = '+5Hz';
      } else if (endsWithExclamation) {
        sentencePitch = '+6Hz';
      } else if (endsWithPeriod) {
        sentencePitch = '-3Hz';
      }

      // 长句分段
      if (charCount > 20) {
        const third = Math.floor(charCount / 3);
        const part1 = trimmed.substring(0, third);
        const part2 = trimmed.substring(third, charCount - third);
        const part3 = trimmed.substring(charCount - third);

        result += `<prosody pitch="+2Hz">${part1}</prosody>`;
        result += `<prosody rate="+3%" pitch="+1Hz">${part2}</prosody>`;
        result += `<prosody pitch="${sentencePitch}">${part3}</prosody>`;
      } else if (charCount > 10) {
        const half = Math.floor(charCount / 2);
        const part1 = trimmed.substring(0, half);
        const part2 = trimmed.substring(half);

        result += `<prosody pitch="+1Hz">${part1}</prosody>`;
        result += `<prosody pitch="${sentencePitch}">${part2}</prosody>`;
      } else {
        result += `<prosody pitch="${sentencePitch}">${trimmed}</prosody>`;
      }

      result += breakTag;
      lastIndex = match.index + match[0].length;
    }

    const remaining = protectedText.substring(lastIndex).trim();
    if (remaining) {
      result += `<prosody pitch="-2Hz">${remaining}</prosody>`;
    }

    result = result.replace(/__SSML_PH_(\d+)__/g, (_, idx) => placeholders[parseInt(idx)]);

    return result;
  }

  async init(): Promise<void> {
    console.log('[EdgeTtsService] 初始化完成');
  }

  /**
   * 预加载音频到缓存（后台静默加载）
   */
  async preload(text: string, language: 'en' | 'zh' = 'en'): Promise<void> {
    try {
      const emotion = this.detectEmotion(text);
      const voice = VOICES[language];

      // 使用情感配置映射表获取参数
      const emotionMap = language === 'zh' ? ZH_EMOTION_MAP : EN_EMOTION_MAP;
      const emotionConfig = emotionMap[emotion] || emotionMap.normal;
      
      // 应用用户设置的语速
      const rate = this.convertRateToPercentage(emotionConfig.rate);
      const pitch = emotionConfig.pitch;

      const cacheKey = this.getCacheKey(text, voice, rate, pitch, emotion);

      if (this.audioCache.has(cacheKey)) {
        console.log(`[EdgeTtsService] 预加载跳过，已在缓存中: "${text.substring(0, 30)}..."`);
        return;
      }

      console.log(`[EdgeTtsService] 开始预加载: "${text.substring(0, 30)}..." [${emotion}]`);
      await this.synthesizeAudio(text, voice, rate, pitch, language, emotion);
      console.log(`[EdgeTtsService] 预加载完成: "${text.substring(0, 30)}..."`);
    } catch (error) {
      console.warn('[EdgeTtsService] 预加载失败:', error);
      // 预加载失败不影响主流程，静默处理
    }
  }

  /**
   * 生成缓存键
   */
  private getCacheKey(text: string, voice: string, rate: string, pitch: string, emotion?: EmotionStyle): string {
    return `${text}|${voice}|${rate}|${pitch}|${emotion || 'normal'}`;
  }

  /**
   * 智能情绪检测 v2
   *
   * 综合以下维度判断文本情感：
   * 1. 标点符号：! → excited, ? → questioning
   * 2. 情感关键词：中英文积极/消极/疑问词汇
   * 3. 上下文模式：鼓励语、批评语、安慰语等
   *
   * @returns 检测到的情感风格
   */
  /**
   * 语气词 → 情感映射表
   * 用于 detectEmotion 中检测语气词并映射到对应情感
   */
  private readonly interjectionEmotionMap: Record<string, EmotionStyle> = {
    // 惊讶/兴奋 → excited
    'wow': 'excited', 'whoa': 'excited', 'yay': 'excited', 'yahoo': 'excited',
    'yippee': 'excited', 'aha': 'excited', 'oh': 'excited', 'ooh': 'excited',
    'ah': 'excited', 'gosh': 'excited', 'geez': 'excited', 'jeez': 'excited',
    'crikey': 'excited', 'blimey': 'excited', 'yikes': 'excited',
    'eureka': 'excited', 'bingo': 'excited', 'voila': 'excited',
    'bravo': 'excited', 'hallelujah': 'excited',
    'woohoo': 'excited', 'wowza': 'excited', 'wee': 'excited',
    'wah': 'excited', 'rah': 'excited', 'ha': 'excited', 'hehe': 'excited',
    'eek': 'excited',
    'hurrah': 'excited', 'hurray': 'excited', 'hooray': 'excited',
    'huzzah': 'excited', 'tada': 'excited',
    // 思考/犹豫 → calm
    'well': 'calm', 'hmm': 'calm', 'um': 'calm', 'uh': 'calm', 'er': 'calm',
    'meh': 'calm', 'huh': 'calm', 'eh': 'calm',
    // 肯定/认同 → friendly
    'uh-huh': 'friendly', 'mm-hmm': 'friendly', 'yeah': 'friendly',
    'yep': 'friendly', 'okay': 'friendly', 'alright': 'friendly',
    'ta': 'friendly', 'cheers': 'friendly', 'amen': 'friendly',
    // 否定 → calm
    'nah': 'calm', 'nope': 'calm', 'uh-uh': 'calm', 'duh': 'calm',
    // 疼痛/意外/厌恶 → sad
    'ouch': 'sad', 'ow': 'sad', 'oops': 'sad', 'whoops': 'sad', 'woops': 'sad',
    'uh-oh': 'sad', 'alas': 'sad', 'ugh': 'sad', 'darn': 'sad', 'doh': 'sad',
    'phew': 'sad', 'whew': 'sad', 'ew': 'sad', 'eew': 'sad', 'ick': 'sad',
    'yuck': 'sad', 'yuk': 'sad', 'bleh': 'sad', 'boo': 'sad', 'oy': 'sad', 'oi': 'sad',
    'aw': 'friendly', 'aww': 'friendly',
    'gah': 'sad', 'grr': 'angry', 'hmph': 'angry',
    'mm': 'calm', 'mmm': 'friendly',
    'oof': 'sad', 'urgh': 'sad', 'yow': 'sad',
    // 问候 → friendly
    'hey': 'friendly', 'hi': 'friendly', 'hello': 'friendly',
    'bye': 'friendly', 'goodbye': 'friendly',
    // 悄悄话 → whispering
    'psst': 'whispering', 'shh': 'whispering',
    // 提醒 → friendly
    'ahem': 'friendly',
    'yo': 'friendly', 'sup': 'friendly', 'yoo-hoo': 'friendly',
    'shoo': 'friendly', "c'mon": 'friendly',
    // 其他
    'brr': 'sad', 'tsk': 'calm', 'tut': 'calm', 'zzz': 'calm',
    // 中文语气词
    '哦': 'excited', '噢': 'excited', '哇': 'excited',
    '嗯': 'calm', '呃': 'calm',
    '啊': 'excited', '哎呀': 'excited', '哎哟': 'sad',
    '唉': 'sad', '喂': 'friendly', '嗨': 'friendly',
    '哈': 'excited', '呵呵': 'friendly', '哈哈': 'excited',
  };

  detectEmotion(text: string): EmotionStyle {
    const trimmed = text.trim().toLowerCase();

    // ====== 英文情感关键词 ======
    const excitedWords = [
      'awesome', 'amazing', 'fantastic', 'wonderful', 'great', 'excellent',
      'perfect', 'brilliant', 'incredible', 'love', 'lovely', 'beautiful',
      'congratulations', 'well done', 'good job', 'keep it up', 'you did it',
      'terrific', 'superb', 'magnificent', 'splendid', 'marvelous',
    ];
    const sadWords = [
      'sorry', 'unfortunately', 'sad', 'unhappy', 'disappointed', 'regret',
      'alas', 'poor', 'difficult', 'hard', 'tough',
    ];
    const angryWords = [
      'angry', 'annoyed', 'frustrated', 'irritated', 'mad', 'furious',
      'terrible', 'awful', 'horrible', 'hate', 'worst',
    ];
    const friendlyWords = [
      'welcome', 'hello', 'hi', 'hey', 'nice to meet', 'pleased',
      'glad', 'happy', 'delighted', 'thank', 'thanks', 'appreciate',
    ];
    const encouragingWords = [
      'try', 'practice', 'keep going', "don't give up", 'you can',
      'believe', 'improve', 'progress', 'better',
    ];
    const whisperingWords = [
      'secret', 'whisper', 'quiet', 'shh', 'silent',
    ];
    const calmWords = [
      'relax', 'calm', 'peaceful', 'serene', 'tranquil', 'easy',
      'breathe', 'slow down', 'take your time', 'no rush',
    ];

    // ====== 中文情感关键词 ======
    const zhExcited = ['太棒', '真棒', '厉害', '优秀', '完美', '漂亮', '太好了', '真厉害', '了不起', '恭喜'];
    const zhSad = ['抱歉', '遗憾', '伤心', '难过', '可惜', '不容易', '辛苦'];
    const zhAngry = ['生气', '愤怒', '糟糕', '太差', '烦人', '讨厌'];
    const zhFriendly = ['欢迎', '你好', '很高兴', '开心', '谢谢', '感谢'];
    const zhEncouraging = ['加油', '坚持', '继续', '努力', '别放弃', '你可以'];

    // ====== 评分系统：计算每种情感的匹配分数 ======
    const scores: Record<string, number> = {
      excited: 0,
      sad: 0,
      angry: 0,
      friendly: 0,
      whispering: 0,
      calm: 0,
      questioning: 0,
    };

    // 1. 语气词检测（优先，语气词强烈暗示情感）
    const firstWord = trimmed.split(/\s+/)[0];
    if (firstWord && this.interjectionEmotionMap[firstWord]) {
      const mappedEmotion = this.interjectionEmotionMap[firstWord];
      scores[mappedEmotion] += 4; // 语气词权重高
    }
    // 检查文本中是否包含其他语气词
    for (const [interj, emotion] of Object.entries(this.interjectionEmotionMap)) {
      if (trimmed.includes(interj)) {
        scores[emotion] += 2;
      }
    }

    // 2. 标点符号检测
    if (trimmed.endsWith('!') || trimmed.endsWith('！')) {
      scores.excited += 2;
    }
    if (trimmed.endsWith('?') || trimmed.endsWith('？')) {
      scores.questioning += 3;
    }

    // 3. 英文关键词检测
    const words = trimmed.split(/\s+/);
    for (const word of words) {
      if (excitedWords.includes(word)) scores.excited += 2;
      if (sadWords.includes(word)) scores.sad += 2;
      if (angryWords.includes(word)) scores.angry += 3;
      if (friendlyWords.includes(word)) scores.friendly += 1.5;
      if (encouragingWords.includes(word)) scores.excited += 1;
      if (whisperingWords.includes(word)) scores.whispering += 3;
      if (calmWords.includes(word)) scores.calm += 2;
    }

    // 4. 中文关键词检测
    for (const kw of zhExcited) { if (trimmed.includes(kw)) scores.excited += 2; }
    for (const kw of zhSad) { if (trimmed.includes(kw)) scores.sad += 2; }
    for (const kw of zhAngry) { if (trimmed.includes(kw)) scores.angry += 3; }
    for (const kw of zhFriendly) { if (trimmed.includes(kw)) scores.friendly += 1.5; }
    for (const kw of zhEncouraging) { if (trimmed.includes(kw)) scores.excited += 1; }

    // 5. 短语模式检测
    if (/^(sorry|i'm sorry|apologies)\b/i.test(trimmed)) scores.sad += 1;
    if (/^(thank|thanks)\b/i.test(trimmed)) scores.friendly += 2;
    if (/^(welcome)\b/i.test(trimmed)) scores.friendly += 1;

    // 6. 文本长度加权：短文本情感更明显
    const wordCount = words.length;
    if (wordCount <= 5) {
      Object.keys(scores).forEach(k => { scores[k] *= 1.2; });
    }

    // ====== 选择最高分的情感 ======
    let bestEmotion: EmotionStyle = 'normal';
    let bestScore = 0;

    for (const [emotion, score] of Object.entries(scores)) {
      if (score > bestScore) {
        bestScore = score;
        bestEmotion = emotion as EmotionStyle;
      }
    }

    // 如果分数太低，使用 normal
    if (bestScore < 1.5) {
      return 'normal';
    }

    console.log(`[EdgeTtsService] 情感检测: "${trimmed.substring(0, 30)}..." → ${bestEmotion} (score=${bestScore})`);
    return bestEmotion;
  }

  /**
   * 拆分中英文文本，支持英文缩写（如 there's, don't, I'll）
   *
   * 将撇号 ' 视为英文字符的一部分，确保缩写词不被拆开。
   * 例如 "there's" 保持为一个完整的英文片段，而不是 "there" + "'s"。
   */
  private splitText(text: string): Array<{ text: string; language: 'en' | 'zh' }> {
    const segments: Array<{ text: string; language: 'en' | 'zh' }> = [];
    let currentText = '';
    let currentLang: 'en' | 'zh' | null = null;

    // 中文字符
    const isChinese = (char: string) => /[\u4e00-\u9fff]/.test(char);
    // 英文字符：字母 + 撇号（支持缩写如 there's, don't, I'll, we're）
    const isEnglish = (char: string) => /[a-zA-Z']/.test(char);
    // 数字也归入当前语言
    const isDigit = (char: string) => /[0-9]/.test(char);

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const charIsChinese = isChinese(char);
      const charIsEnglish = isEnglish(char);
      const charIsDigit = isDigit(char);

      let charLang: 'en' | 'zh' | null = null;
      if (charIsChinese) charLang = 'zh';
      else if (charIsEnglish || charIsDigit) charLang = 'en';

      if (charLang !== currentLang && currentText.length > 0) {
        if (currentLang) {
          segments.push({ text: currentText.trim(), language: currentLang });
        }
        currentText = char;
        currentLang = charLang;
      } else {
        currentText += char;
        if (charLang) currentLang = charLang;
      }
    }

    if (currentText.trim().length > 0 && currentLang) {
      segments.push({ text: currentText.trim(), language: currentLang });
    }

    return segments;
  }

  /**
   * 调用 Supabase Edge Function 合成音频
   */
  private async synthesizeAudio(text: string, voice: string, rate: string, pitch: string, language: 'en' | 'zh' = 'en', emotion: EmotionStyle = 'normal'): Promise<string> {
    // 生成 SSML
    const ssml = this.generateSsml(text, voice, rate, pitch, language, emotion);
    const cacheKey = this.getCacheKey(text, voice, rate, pitch, emotion);

    // 检查缓存
    if (this.audioCache.has(cacheKey)) {
      console.log(`[EdgeTtsService] 从缓存获取音频，无需请求 API`);
      return this.audioCache.get(cacheKey)!;
    }

    console.log(`[EdgeTtsService] 调用 TTS API: voice=${voice}, rate=${rate}, pitch=${pitch}`);
    console.log(`[EdgeTtsService] SSML:`, ssml.substring(0, 200));

    const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

    const response = await fetch(TTS_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseAnonKey,
        'Authorization': `Bearer ${supabaseAnonKey}`,
      },
      body: JSON.stringify({
        text,
        voice,
        rate,
        pitch,
        ssml,
        language,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`TTS API failed: ${response.status} - ${errorText}`);
    }

    // 解析 JSON 响应
    const data = await response.json();
    console.log(`[EdgeTtsService] 接收到响应:`, { success: data.success, audioBase64Length: data.audioBase64?.length });

    if (!data.success || !data.audioBase64) {
      throw new Error('TTS API returned invalid response');
    }

    // 直接使用后端返回的 base64 字符串，添加 data URI 前缀
    const audioUri = 'data:audio/mpeg;base64,' + data.audioBase64;
    console.log(`[EdgeTtsService] 音频 URI 准备完成，长度: ${audioUri.length}`);

    // 存入缓存
    this.audioCache.set(cacheKey, audioUri);
    console.log(`[EdgeTtsService] 音频已缓存，当前缓存数: ${this.audioCache.size}`);

    return audioUri;
  }

  async speak(options: TtsOptions): Promise<() => void> {
    const { text, language = 'en', emotion, onStart, onDone, onError, onProgress } = options;

    const detectedEmotion = emotion || this.detectEmotion(text);

    console.log(`[EdgeTtsService] 播放: [${language}][${detectedEmotion}] "${text.substring(0, 30)}..."`);

    this.isPlaying = true;
    this.currentText = text;
    this.onDoneCallback = onDone || null;
    this.onProgressCallback = onProgress || null;

    try {
      // 使用情感配置映射表获取参数
      const emotionMap = language === 'zh' ? ZH_EMOTION_MAP : EN_EMOTION_MAP;
      const emotionConfig = emotionMap[detectedEmotion] || emotionMap.normal;
      
      const voice = VOICES[language];
      let baseRate = emotionConfig.rate;
      let pitch = emotionConfig.pitch;

      // ===== 检测是否为单个单词（非句子），如果是则使用更慢语速+更高音调，保证咬字清晰 =====
      // 判断条件：英文文本，不含空格、标点、换行，长度不超过 30 个字符
      const trimmed = text.trim();
      const isSingleWord = language === 'en' && /^[a-zA-Z]+(?:'[a-zA-Z]+)?$/.test(trimmed) && trimmed.length <= 30;
      if (isSingleWord) {
        console.log(`[EdgeTtsService] 检测到单个单词 "${trimmed}"，使用清晰发音模式`);
        // 使用更慢的语速（-20%）和稍高的音调（+6Hz），让单词读得更清晰
        baseRate = '-20%';
        pitch = '+6Hz';
      }
      
      // 应用用户设置的语速
      const rate = this.convertRateToPercentage(baseRate);

      console.log(`[EdgeTtsService] 音色: ${voice}, rate: ${rate}, pitch: ${pitch}, emotion: ${detectedEmotion}(${emotionConfig.style}, degree=${emotionConfig.degree})`);

      const audioUri = await this.synthesizeAudio(text, voice, rate, pitch, language, detectedEmotion);

      await this.playAudio(audioUri, onStart, () => {
        this.isPlaying = false;
        this.clearProgressInterval();
        if (this.onDoneCallback) {
          this.onDoneCallback();
          this.onDoneCallback = null;
        }
        onDone?.();
      }, onError);

    } catch (error) {
      console.error('[EdgeTtsService] 合成失败:', error);
      this.isPlaying = false;
      this.clearProgressInterval();
      onError?.(error);
    }

    return () => this.stop();
  }

  private async playAudio(
    uri: string,
    onStart?: () => void,
    onDone?: () => void,
    onError?: (error: any) => void
  ): Promise<void> {
    try {
      // 先触发 onStart，让用户立即知道开始播放了
      onStart?.();

      if (this.sound) {
        await this.sound.unloadAsync();
        this.sound = null;
      }

      // 设置音频模式为播放模式
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: false,
        playThroughEarpieceAndroid: false,
      } as any);

      console.log('[EdgeTtsService] 播放音频，URI 长度:', uri.length);

      const { sound } = await Audio.Sound.createAsync(
        { uri },
        {
          shouldPlay: true,
          progressUpdateIntervalMillis: 50, // 更频繁的更新，确保高亮流畅
          isLooping: false,
          shouldCorrectPitch: false,
        },
        (status) => {
          if (status.isLoaded && status.didJustFinish) {
            // 播放完成，设置为 100% 进度
            if (this.onProgressCallback && this.currentText) {
              this.onProgressCallback(this.currentText.length);
            }
            onDone?.();
          }
          
          // 使用音频的实际播放位置来计算字符进度
          if (status.isLoaded && status.positionMillis !== undefined && status.durationMillis !== undefined && status.durationMillis > 0) {
            const progressRatio = status.positionMillis / status.durationMillis;
            const targetCharIndex = Math.floor(progressRatio * this.currentText.length);
            
            if (this.onProgressCallback) {
              this.onProgressCallback(Math.min(targetCharIndex, this.currentText.length));
            }
          }
        }
      );

      this.sound = sound;
      // 不再需要人工的 progressInterval，因为我们使用音频的真实进度

    } catch (error) {
      console.error('[EdgeTtsService] 播放失败:', error);
      onError?.(error);
    }
  }

  private clearProgressInterval(): void {
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
      this.progressInterval = null;
    }
  }

  stop(): void {
    this.clearProgressInterval();
    this.isPlaying = false;
    if (this.sound) {
      this.sound.unloadAsync();
      this.sound = null;
    }
  }

  /**
   * 混合播放（支持中英文自动切换，情感化朗读）
   *
   * @param text - 要播放的文本
   * @param onStart - 开始播放回调
   * @param onDone - 播放完成回调
   * @param onError - 错误回调
   * @param onProgress - 进度回调 (segmentIndex, charIndex)
   * @param emotions - 可选，每个片段对应的情感数组，长度需与 splitText 结果一致
   */
  async speakMixed(
    text: string,
    onStart?: () => void,
    onDone?: () => void,
    onError?: (error: any) => void,
    onProgress?: (segmentIndex: number, charIndex: number) => void,
    emotions?: EmotionStyle[]
  ): Promise<() => void> {
    const segments = this.splitText(text);
    console.log(`[EdgeTtsService] 混合播放，共 ${segments.length} 段`);

    if (segments.length === 0) {
      onDone?.();
      return () => {};
    }

    // 检查是否是纯英文或纯中文
    const hasEnglish = segments.some(s => s.language === 'en');
    const hasChinese = segments.some(s => s.language === 'zh');
    const isPure = !hasEnglish || !hasChinese;

    if (isPure) {
      // 纯英文或纯中文，直接一次性播放
      console.log(`[EdgeTtsService] 纯 ${hasEnglish ? '英文' : '中文'}，直接一次性播放`);
      const language = hasEnglish ? 'en' : 'zh';
      const emotion = emotions?.[0];
      return await this.speak({
        text,
        language,
        emotion,
        onStart,
        onDone,
        onError,
        onProgress: (charIndex) => onProgress?.(0, charIndex)
      });
    }

    // 确实是混合语言，按片段播放
    let currentSegmentIndex = 0;
    let isCancelled = false;

    const playNextSegment = async () => {
      if (isCancelled || currentSegmentIndex >= segments.length) {
        onDone?.();
        return;
      }

      const segment = segments[currentSegmentIndex];
      const segmentEmotion = emotions?.[currentSegmentIndex];

      await this.speak({
        text: segment.text,
        language: segment.language,
        emotion: segmentEmotion,
        onStart: currentSegmentIndex === 0 ? onStart : undefined,
        onDone: () => {
          currentSegmentIndex++;
          playNextSegment();
        },
        onError,
        onProgress: (charIndex) => {
          onProgress?.(currentSegmentIndex, charIndex);
        }
      });
    };

    playNextSegment();

    return () => {
      isCancelled = true;
      this.stop();
    };
  }
}

export default new EdgeTtsService();