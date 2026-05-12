/**
 * textCleaner — 文本预处理工具
 *
 * 用于在朗读（TTS）和口语评测（ISE）前，移除/替换可能导致
 * 朗读引擎读出特殊符号（如 "underscore"）的字符。
 *
 * 原则：
 *   - 仅修改传给「读音/评测」引擎的文本字符串
 *   - 不修改 UI 界面上显示的文本
 */

/**
 * 清除文本中的特殊符号，确保朗读/评测引擎不会读出无用字符
 *
 * 处理规则：
 * 1. 下划线 _ → 替换为空格
 * 2. 连续空格 → 合并为单个空格
 * 3. 首尾空格 → 去除
 *
 * @param text 原始文本（可能是包含下划线等符号的英文）
 * @returns 清理后的文本（仅用于语音朗读或评测打分参考）
 */
export function cleanTextForSpeech(text: string): string {
  if (!text) return text;

  return text
    // 下划线替换为空格
    .replace(/_/g, ' ')
    // 连续空格合并为单个空格
    .replace(/\s+/g, ' ')
    // 首尾去空格
    .trim();
}
