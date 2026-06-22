/**
 * AuthContext — 集中式认证状态管理 + 路由守卫
 *
 * 职责：
 * 1. 监听 Supabase auth 状态变化
 * 2. 提供全局 authState（loading / unauthenticated / authenticated）
 * 3. 在 authenticated 状态下自动查询 profiles 表确认身份
 * 4. 提供 signOut 方法（统一清理逻辑）
 *
 * 状态机：
 *   loading        → 正在检测 session / profile，显示全屏 Loading
 *   unauthenticated → session === null，强制跳转 /login
 *   authenticated   → session 存在 + profile 确认完毕，允许访问首页
 *
 * 防"抢跑"机制：
 *   - isInitializing: onAuthStateChange 首次回调前保持 true，禁止路由跳转
 *   - initializedRef: resolveAuthState 首次执行完毕前禁止路由跳转
 *   - 500ms 强制延迟: 给本地 Token 存储留出读取时间
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter, useSegments } from 'expo-router';
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';

import { supabase } from './supabaseClient';

// ============================================================
// 类型定义
// ============================================================
export type AuthState = 'loading' | 'unauthenticated' | 'authenticated';

export interface AuthContextValue {
  /** 当前认证状态 */
  authState: AuthState;
  /** 当前用户 ID（authenticated 时可用） */
  userId: string | null;
  /** 当前用户邮箱 */
  userEmail: string | null;
  /** 统一退出登录 */
  signOut: () => Promise<void>;
  /** 手动刷新认证状态 */
  refreshAuthState: () => Promise<void>;
  /** 是否正在初始化（onAuthStateChange 首次回调前为 true） */
  isInitializing: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// ============================================================
// Provider
// ============================================================
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const segments = useSegments();
  const [authState, setAuthState] = useState<AuthState>('unauthenticated');
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const isFirstRender = useRef(true);
  // 初始化完成标记：resolveAuthState 首次执行完毕前为 false，禁止路由跳转
  const initializedRef = useRef(false);
  // 是否正在初始化（onAuthStateChange 首次回调前为 true）
  const [isInitializing, setIsInitializing] = useState(true);
  // 防重入锁：防止 resolveAuthState 被并发调用（如 getUser 触发 TOKEN_REFRESHED 事件导致递归）
  const resolvingRef = useRef(false);

  /**
   * 查询 profiles 表确认用户身份
   * 增加详细日志以诊断 RLS / 数据问题
   * 区分"网络异常"和"账号不存在"
   */
  const checkProfileExists = async (uid: string): Promise<{ exists: boolean; error?: string; avatarType?: number }> => {
    try {
      if (!uid) {
        console.warn('[AuthContext] checkProfileExists: uid 为空，跳过查询');
        return { exists: false };
      }

      console.log('[AuthContext] checkProfileExists: 查询 profiles, user.id =', uid);
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, nickname, avatar_type')
        .eq('id', uid)
        .maybeSingle();

      if (error) {
        console.error('[AuthContext] checkProfileExists 查询失败:', error.message);
        return { exists: false, error: error.message };
      }

      if (!data) {
        console.warn('[AuthContext] checkProfileExists: 未找到 profile 记录');
        return { exists: false };
      }

      console.log('[AuthContext] checkProfileExists: 查询成功, profile =', JSON.stringify(data));
      return { exists: true, avatarType: data.avatar_type };
    } catch (err) {
      console.error('[AuthContext] checkProfileExists 异常:', err);
      return { exists: false, error: '网络异常' };
    }
  };

  /**
   * 核心：检测认证状态
   *
   * 策略：预设乐观 + 后台静默校验
   *   1. 调用 getUser() 获取当前用户（会自动刷新过期的 access token）
   *   2. 如果用户有效 → 立即设为 authenticated，渲染主页面
   *   3. 后台异步校验 profile 是否存在
   *     3a. profile 存在 → 保持 authenticated，更新 userId/userEmail
   *     3b. profile 不存在 → 静默跳转回登录页（用户无感知转圈）
   *     3c. 网络异常 → 保持 authenticated，不阻塞用户（下次打开再校验）
   *   4. 如果用户无效（无 session 或 refresh token 也过期）→ unauthenticated，显示登录页
   *
   * ★ 为什么用 getUser() 而不是 getSession()？
   * getSession() 只从本地存储读取 session，不会自动刷新过期的 access token。
   * 当应用长时间不运行后，access token 过期，getSession() 返回的 session 虽然存在
   * 但已不可用，导致后续 API 调用失败。
   * getUser() 内部会检查 access token 是否过期，如果过期会自动用 refresh token 刷新，
   * 刷新成功则返回新的用户信息，刷新失败（refresh token 也过期）则返回 null。
   */
  const resolveAuthState = async () => {
    // 防重入锁：如果已经有 resolveAuthState 正在执行，跳过本次调用
    // 防止 getUser() 触发 TOKEN_REFRESHED 事件 → onAuthStateChange → resolveAuthState 递归
    if (resolvingRef.current) {
      console.log('[AuthContext] resolveAuthState 已在执行中，跳过重入调用');
      return;
    }
    resolvingRef.current = true;
    try {
      // Step 1: 获取当前用户（自动处理 token 刷新）
      const { data: { user }, error: userError } = await supabase.auth.getUser();

      if (userError) {
        // getUser 失败：可能是网络错误或 refresh token 过期
        console.warn('[AuthContext] getUser 失败:', userError.message);

        // 尝试用 refreshSession 兜底（getUser 在某些版本可能不自动刷新）
        const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
        if (refreshError || !refreshData?.session) {
          console.log('[AuthContext] refreshSession 也失败 → unauthenticated');
          setAuthState('unauthenticated');
          setUserId(null);
          setUserEmail(null);
          initializedRef.current = true;
          setIsInitializing(false);
          return;
        }

        // refreshSession 成功，使用刷新后的 session
        const refreshedUser = refreshData.session.user;
        console.log('[AuthContext] refreshSession 成功, user.id =', refreshedUser.id);
        setUserId(refreshedUser.id);
        setUserEmail(refreshedUser.email || '');
        setAuthState('authenticated');
        initializedRef.current = true;
        setIsInitializing(false);

        // 后台异步校验 profile
        const refreshProfileResult = await checkProfileExists(refreshedUser.id);
        if (refreshProfileResult.error) {
          console.warn('[AuthContext] refreshSession 后 profile 校验网络异常，保持登录状态:', refreshProfileResult.error);
        } else if (!refreshProfileResult.exists) {
          console.warn('[AuthContext] refreshSession 后 profile 不存在（可能刚注册），保持登录状态');
        } else {
          console.log('[AuthContext] refreshSession 后 profile 校验成功');
        }
        return;
      }

      if (!user) {
        console.log('[AuthContext] 无用户 → unauthenticated');
        setAuthState('unauthenticated');
        setUserId(null);
        setUserEmail(null);
        initializedRef.current = true;
        setIsInitializing(false);
        return;
      }

      const uid = user.id;
      const email = user.email || '';
      console.log('[AuthContext] 用户有效, user.id =', uid);

      // 预设乐观：立即设为 authenticated，渲染主页面
      setUserId(uid);
      setUserEmail(email);
      setAuthState('authenticated');
      initializedRef.current = true;
      setIsInitializing(false);

      // 后台异步校验 profile（不阻塞 UI）
      const profileResult = await checkProfileExists(uid);

      if (profileResult.error) {
        // 网络异常 → 保持 authenticated，不阻塞用户
        console.warn('[AuthContext] 后台 profile 校验网络异常，保持登录状态:', profileResult.error);
        return;
      }

      let avatarType = profileResult.avatarType;

      if (!profileResult.exists) {
        // 重试 1 次（处理 DB 触发器延迟）
        console.log('[AuthContext] 后台首次未查到 profile，1 秒后重试...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        const retryResult = await checkProfileExists(uid);

        if (retryResult.error) {
          console.warn('[AuthContext] 后台重试网络异常，保持登录状态:', retryResult.error);
          return;
        }

        if (!retryResult.exists) {
          // 重试后仍没有 → 静默跳转回登录页
          // ⚠️ 注意：这里会导致循环！如果 session 仍然有效，onAuthStateChange 会再次触发
          console.warn('[AuthContext] ⚠️ 后台 profile 校验失败（重试后仍无记录），静默跳转登录页');
          console.log('[AuthContext] 🔍 DEBUG: uid=', uid, 'session仍有效，即将触发循环');
          setAuthState('unauthenticated');
          setUserId(null);
          setUserEmail(null);
          // 路由守卫会自动处理跳转
          return;
        }

        avatarType = retryResult.avatarType;
      }

      // ============================================================
      // 盲盒头像：如果 avatar_type 为空，自动分配 1（小猫）或 2（小怪物）
      // ============================================================
      if (!avatarType) {
        const randomNum = Math.floor(Math.random() * 2) + 1; // 1 或 2
        console.log('[AuthContext] avatar_type 为空，自动分配盲盒头像:', randomNum === 1 ? '🐱 小猫' : '👹 小怪物');

        const { error: updateError } = await supabase
          .from('profiles')
          .update({ avatar_type: randomNum })
          .eq('id', uid);

        if (updateError) {
          console.warn('[AuthContext] 自动分配 avatar_type 失败:', updateError);
        } else {
          console.log('[AuthContext] avatar_type 已永久锁定为:', randomNum);
        }
      } else {
        console.log('[AuthContext] avatar_type 已存在:', avatarType);
      }

      console.log('[AuthContext] 后台 profile 校验成功');
    } catch (err) {
      console.error('[AuthContext] resolveAuthState 异常:', err);
      // 异常时确保初始化完成，显示登录页而不是黑屏
      initializedRef.current = true;
      setIsInitializing(false);
      setAuthState('unauthenticated');
    } finally {
      resolvingRef.current = false;
    }
  };

  // 初始化：检测认证状态
  useEffect(() => {
    resolveAuthState();
  }, []);

  // 监听 Supabase auth 状态变化
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('[AuthContext] onAuthStateChange:', event, 'user.id =', session?.user?.id);

      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        if (session) {
          // 重新检测 profile
          await resolveAuthState();
        }
      } else if (event === 'SIGNED_OUT') {
        console.log('[AuthContext] SIGNED_OUT → unauthenticated');
        setAuthState('unauthenticated');
        setUserId(null);
        setUserEmail(null);
      }
    });

    return () => subscription?.unsubscribe();
  }, []);

  // 路由守卫：根据 authState 自动跳转
  useEffect(() => {
    // 跳过首次渲染，避免与 SplashScreen 冲突
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    // 初始化未完成时禁止跳转，防止 session 判定过快导致闪屏
    if (!initializedRef.current) {
      console.log('[AuthContext] 路由守卫: 初始化未完成，跳过跳转');
      return;
    }

    // isInitializing 为 true 时禁止跳转（onAuthStateChange 首次回调前）
    if (isInitializing) {
      console.log('[AuthContext] 路由守卫: 正在初始化中，跳过跳转');
      return;
    }

    const inAuthGroup = segments[0] === 'login' || segments[0] === 'register';

    if (authState === 'unauthenticated' && !inAuthGroup) {
      // 未登录且不在登录/注册页 → 强制跳转登录页
      console.log('[AuthContext] 路由守卫: 未登录 → 跳转 /login');
      router.replace('/login');
    } else if (authState === 'authenticated' && inAuthGroup) {
      // 已登录且在登录/注册页 → 跳转首页
      console.log('[AuthContext] 路由守卫: 已登录 → 跳转首页');
      router.replace('/(tabs)');
    }
  }, [authState, segments, isInitializing]);

  const signOut = async () => {
    try {
      console.log('[AuthContext] signOut: 开始退出登录');
      await supabase.auth.signOut();
      await AsyncStorage.clear();
      setAuthState('unauthenticated');
      setUserId(null);
      setUserEmail(null);
      router.replace('/login');
      console.log('[AuthContext] signOut: 完成');
    } catch (err) {
      console.error('[AuthContext] signOut 失败:', err);
    }
  };

  const refreshAuthState = async () => {
    await resolveAuthState();
  };

  return (
    <AuthContext.Provider
      value={{
        authState,
        userId,
        userEmail,
        signOut,
        refreshAuthState,
        isInitializing,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// ============================================================
// Hook
// ============================================================
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
