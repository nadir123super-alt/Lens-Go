/**
 * PracticeTab — 口语练习 Tab 页面
 *
 * 设计目标：底部导航栏"口语"Tab 唯一入口
 *
 * 渲染逻辑（基于 Context 状态）：
 *   1. isPracticeFinished=true 且有成绩数据 → 渲染 EvaluationSummaryScreen
 *      （用户切到其他 Tab 再回来时，依然看到成绩页而非空白页）
 *   2. isPracticeFinished=false → 渲染 PracticeScreen（练习卡片页面）
 *   3. 每次 practiceVersion 变化时 key 更新，强制 PracticeScreen 完全重挂载
 *
 * "再练一组"按钮在 EvaluationSummaryScreen 中：
 *   1. 预取新单词（fetchNextPracticeSet → setPendingSession）
 *   2. 调用 resetPractice() → isPracticeFinished=false, practiceVersion++
 *   3. 版本变化触发 key 更新 → PracticeScreen 重新挂载 → 读取 pending session → 开始新练习
 */
import React, { useEffect, useRef, useState } from 'react';
import EvaluationSummaryScreen from '../(tabs)/evaluation-summary';
import { usePracticeContext } from '../../services/practiceContext';
import PracticeScreen from '../practice';

export default function PracticeTab() {
  const { isPracticeFinished, lastScores, practiceVersion } = usePracticeContext();

  // 本地 key，跟踪当前"练习轮次"
  // practiceVersion 变化时 increment，强制 PracticeScreen 重新挂载
  const [sessionKey, setSessionKey] = useState(0);
  const prevVersionRef = useRef(practiceVersion);

  // 监听 practiceVersion 变化 → 递增 key
  useEffect(() => {
    if (prevVersionRef.current !== practiceVersion) {
      prevVersionRef.current = practiceVersion;
      setSessionKey((k) => k + 1);
      console.log('[PracticeTab] practiceVersion 变化 → sessionKey:', sessionKey + 1);
    }
  }, [practiceVersion]);

  // 练习未完成，或者刚被 resetPractice() 重置 → 显示练习界面
  if (!isPracticeFinished) {
    return <PracticeScreen key={`practice-${sessionKey}`} />;
  }

  // 练习已完成，但有成绩数据 → 显示成绩页
  // 没有成绩数据说明刚加载（理论上不会发生，兜底）
  if (lastScores.length === 0) {
    return <PracticeScreen key={`practice-${sessionKey}`} />;
  }

  return <EvaluationSummaryScreen />;
}
