/**
 * dataPreloader — 缓存预加载模块
 *
 * 设计目标：
 *   在用户点击底部导航栏图标的一瞬间就开始发起网络请求，
 *   而不是等页面组件 useEffect 挂载后再请求。
 *
 * 使用方式：
 *   - Tab Layout 的 onPress 中调用 preloadXXX() 触发预加载
 *   - 页面组件中调用 consumePreloadedXXX() 消费缓存数据
 *   - 如果缓存命中，直接使用缓存数据，不再发起网络请求
 *   - 缓存数据使用后即销毁（一次性消费）
 */

// ====== 生词本预加载 ======

import { getVocabulary, VocabEntry } from './vocabularyService';

let vocabCache: VocabEntry[] | null = null;
let vocabPromise: Promise<VocabEntry[]> | null = null;

/**
 * 在用户点击"生词本"Tab 时调用，提前发起网络请求
 */
export function preloadVocabulary(): void {
  if (vocabCache !== null || vocabPromise !== null) return; // 已缓存或已在请求中
  vocabPromise = getVocabulary().then((data) => {
    vocabCache = data;
    vocabPromise = null;
    return data;
  }).catch((err) => {
    vocabPromise = null; // 失败后允许重试
    throw err;
  });
}

/**
 * 在 VocabularyScreen 组件挂载时调用，消费预加载的缓存
 * 返回 null 表示没有缓存数据，需要自行发起请求
 */
export function consumePreloadedVocabulary(): VocabEntry[] | null {
  const data = vocabCache;
  vocabCache = null; // 一次性消费
  vocabPromise = null;
  return data;
}

/**
 * 清除生词本缓存（用于强制刷新）
 */
export function clearVocabularyCache(): void {
  vocabCache = null;
  vocabPromise = null;
}

// ====== 口语练习预加载 ======

import { fetchNextPracticeSet, PracticeSession } from './practiceService';

let practiceCache: PracticeSession | null = null;
let practicePromise: Promise<PracticeSession> | null = null;

/**
 * 在用户点击"口语练习"Tab 时调用，提前发起网络请求
 */
export function preloadPractice(): void {
  if (practiceCache !== null || practicePromise !== null) {
    console.log('[dataPreloader] preloadPractice -- skip (cache exists: ' + (practiceCache ? 'words=' + practiceCache.words.length : 'request in flight') + ')');
    return;
  }
  console.log('[dataPreloader] preloadPractice -- fetching');
  practicePromise = fetchNextPracticeSet().then((data) => {
    practiceCache = data;
    practicePromise = null;
    console.log('[dataPreloader] preloadPractice -- cached: words=' + data.words.length + ', completed=' + data.completed);
    return data;
  }).catch((err) => {
    practicePromise = null;
    console.warn('[dataPreloader] preloadPractice -- error:', err?.message);
    throw err;
  });
}

/**
 * 在 PracticeScreen 组件挂载时调用，消费预加载的缓存
 */
export function consumePreloadedPractice(): PracticeSession | null {
  const data = practiceCache;
  practiceCache = null;
  practicePromise = null;
  return data;
}

/**
 * 清除口语练习缓存
 */
export function clearPracticeCache(): void {
  practiceCache = null;
  practicePromise = null;
}
