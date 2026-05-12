/**
 * EvaluationSummaryView — 页面已迁移到 (tabs)/evaluation-summary
 *
 * 此文件作为向后兼容的引用文件，防止旧路径导航报错。
 * 实际代码在 app/(tabs)/evaluation-summary.tsx。
 */

import { Redirect } from 'expo-router';

export default function EvaluationSummaryRedirect() {
  return <Redirect href="/(tabs)/evaluation-summary" />;
}
