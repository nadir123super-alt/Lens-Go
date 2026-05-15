/**
 * audioCounter — 全局音频播放计数器
 *
 * 职责：
 * 1. 跟踪全局音频完整播放次数（用于"复读机"勋章）
 * 2. 跟踪页面级本地播放次数（用于批量同步）
 * 3. 跟踪每个单词的发音点击次数（用于"念念不忘"勋章）
 *
 * 提取为独立文件以打破 achievementService ↔ soundManager 的循环引用。
 */

// 发音播放完成计数器（用于"复读机"勋章）
// 本地缓冲计数：只在音频完整播放完毕时才加 1
let _audioPlayCompleteCount = 0;

// 页面级本地计数器（用于批量同步）
let _pageLocalCount = 0;

// 每个单词的发音点击次数（用于"念念不忘"勋章）
// key: 单词小写, value: 点击次数
const _wordClickCounts: Record<string, number> = {};

/** 获取全局音频播放完成次数 */
export function getAudioPlayCompleteCount(): number {
  return _audioPlayCompleteCount;
}

/** 增加全局音频播放完成次数 */
export function incrementAudioPlayCompleteCount(): void {
  _audioPlayCompleteCount++;
}

/** 获取页面级本地计数器 */
export function getPageLocalCount(): number {
  return _pageLocalCount;
}

/** 增加页面级本地计数器 */
export function incrementPageLocalCount(): void {
  _pageLocalCount++;
}

/** 重置页面本地计数器（页面加载时调用） */
export function resetPageLocalCount(): void {
  _pageLocalCount = 0;
}

/** 获取并重置页面本地计数器（页面卸载时调用，用于批量同步） */
export function consumePageLocalCount(): number {
  const count = _pageLocalCount;
  _pageLocalCount = 0;
  return count;
}

// ─── 单词级发音点击追踪（用于"念念不忘"勋章） ────────

/**
 * 记录某个单词的发音点击
 * @param word 被点击发音的单词
 * @returns 该单词累计点击次数
 */
export function recordWordClick(word: string): number {
  const key = word.toLowerCase().trim();
  _wordClickCounts[key] = (_wordClickCounts[key] || 0) + 1;
  return _wordClickCounts[key];
}

/**
 * 获取所有单词的点击次数映射
 */
export function getWordClickCounts(): Record<string, number> {
  return { ..._wordClickCounts };
}

/**
 * 获取指定单词的点击次数
 */
export function getWordClickCount(word: string): number {
  return _wordClickCounts[word.toLowerCase().trim()] || 0;
}

/**
 * 重置所有单词点击计数（通常用于测试）
 */
export function resetWordClickCounts(): void {
  for (const key of Object.keys(_wordClickCounts)) {
    delete _wordClickCounts[key];
  }
}
