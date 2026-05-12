/**
 * PracticeContext — 口语练习全局状态 Context
 *
 * 解决 Tab 切换导致状态丢失的问题：
 *   - isPracticeFinished: 练习完成后设为 true，Tab 切回时直接显示成绩页
 *   - lastScores: 持久保存最近一次练习的成绩数据
 *   - lastSession: 保存最近一次练习的 session（用于重算/查看）
 *
 * 使用方式：
 *   const { isPracticeFinished, lastScores, finishPractice, resetPractice } = usePracticeContext();
 */

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { CardScore, PracticeSession } from './practiceService';

// ====== Context 类型 ======

interface PracticeContextType {
  /** 练习是否已完成（应该显示成绩页而非练习页） */
  isPracticeFinished: boolean;
  /** 最近一次练习的成绩数据 */
  lastScores: CardScore[];
  /** 最近一次练习的 Session（可用于重算/查看） */
  lastSession: PracticeSession | null;
  /** 递增版本号，每次新练习开始 +1，用于强制重挂载组件 */
  practiceVersion: number;

  /** 标记练习完成，保存成绩 */
  finishPractice: (scores: CardScore[], session: PracticeSession) => void;
  /** 重置练习状态（用户点击"再练一组"时调用） */
  resetPractice: () => void;
  /** 更新成绩数据（用于从缓存补全读取后） */
  setLastScores: (scores: CardScore[]) => void;
}

// ====== 默认值 ======

const defaultContext: PracticeContextType = {
  isPracticeFinished: false,
  lastScores: [],
  lastSession: null,
  practiceVersion: 0,
  finishPractice: () => {},
  resetPractice: () => {},
  setLastScores: () => {},
};

// ====== Context ======

const PracticeContext = createContext<PracticeContextType>(defaultContext);

// ====== Provider ======

export function PracticeProvider({ children }: { children: React.ReactNode }) {
  const [isPracticeFinished, setIsPracticeFinished] = useState(false);
  const [lastScores, setLastScoresState] = useState<CardScore[]>([]);
  const [lastSession, setLastSession] = useState<PracticeSession | null>(null);
  const [practiceVersion, setPracticeVersion] = useState(0);

  const finishPractice = useCallback((scores: CardScore[], session: PracticeSession) => {
    setIsPracticeFinished(true);
    setLastScoresState(scores);
    setLastSession(session);
    console.log('[PracticeContext] ✅ 练习完成，成绩已持久化到 Context');
  }, []);

  const resetPractice = useCallback(() => {
    setIsPracticeFinished(false);
    setLastScoresState([]);
    setLastSession(null);
    setPracticeVersion((v) => v + 1);
    console.log('[PracticeContext] 🔄 练习状态已重置 (version +1)');
  }, []);

  const setLastScores = useCallback((scores: CardScore[]) => {
    setLastScoresState(scores);
  }, []);

  const value = useMemo(() => ({
    isPracticeFinished,
    lastScores,
    lastSession,
    practiceVersion,
    finishPractice,
    resetPractice,
    setLastScores,
  }), [isPracticeFinished, lastScores, lastSession, practiceVersion, finishPractice, resetPractice, setLastScores]);

  return (
    <PracticeContext.Provider value={value}>
      {children}
    </PracticeContext.Provider>
  );
}

// ====== Hook ======

export function usePracticeContext(): PracticeContextType {
  const context = useContext(PracticeContext);
  if (!context) {
    throw new Error('usePracticeContext must be used within a PracticeProvider');
  }
  return context;
}
