/**
 * businessParams — 讯飞语音评测业务参数配置
 *
 * 将基础参数、高级参数与文本 Base64 组合为符合 API 规范的 JSON 对象。
 *
 * 参考文档：https://www.xfyun.cn/doc/Ise/Ise-API.html#业务参数
 */

// ========== 类型定义 ==========

/** 评测语种 */
export type XFEnt = 'cn_vip' | 'en_vip';

/** 评测题型 */
export type XFCategory =
  | 'read_sentence'   // 句子评测
  | 'read_word'       // 单词评测
  | 'read_chapter'    // 篇章评测
  | 'read_choice';    // 选择题评测

/** 音频编码格式 */
export type XFAue = 'raw' | 'speex' | 'speex-wb' | 'amr' | 'amr-wb' | 'amr-nb' | 'opus';

/** 业务参数（基础 + 高级） */
export interface XFBusinessParams {
  /** 语种（默认 cn_vip） */
  ent: XFEnt;
  /** 评测题型（默认 read_sentence） */
  category: XFCategory;
  /** 音频编码格式（默认 raw，即 PCM） */
  aue: XFAue;
  /** 是否开启多维度评分（准确度/流畅度/完整度等） */
  extra_ability: string;
  /** 待评测文本的 Base64（UTF-8 + BOM） */
  text: string;
}

/** 外部可覆盖的自定义配置 */
export interface XFCustomConfig {
  ent?: XFEnt;
  category?: XFCategory;
  aue?: XFAue;
  extra_ability?: string;
}

// ========== 默认配置常量 ==========

export const XF_PARAMS_DEFAULTS: Omit<XFBusinessParams, 'text'> = {
  ent: 'cn_vip',
  category: 'read_sentence',
  aue: 'raw',
  extra_ability: 'multi_dimension',
};

// ========== 工具函数 ==========

/**
 * 将文本 Base64 与业务参数组合为完整的 JSON 业务参数对象
 *
 * @param textBase64  - 经 prepareXFText() 处理后的 Base64 文本
 * @param customConfig - 可选的覆盖配置（ent / category / aue / extra_ability）
 * @returns 符合讯飞 API 规范的业务参数对象
 *
 * 使用示例：
 *   const textB64 = prepareXFText("hello world");
 *   const params = getBusinessParams(textB64, { ent: 'en_vip' });
 *   ws.send(JSON.stringify({ business: params, ... }));
 */
export function getBusinessParams(
  textBase64: string,
  customConfig?: XFCustomConfig,
): XFBusinessParams {
  const merged: XFBusinessParams = {
    ...XF_PARAMS_DEFAULTS,
    text: textBase64,
    ...customConfig,
  };

  console.log('[xf_speech] 📦 业务参数:', {
    ent: merged.ent,
    category: merged.category,
    aue: merged.aue,
    extra_ability: merged.extra_ability,
    textLength: merged.text.length,
  });

  return merged;
}
