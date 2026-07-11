/**
 * phoneAuthService — 手机号认证服务
 *
 * 职责：
 * 1. 发送短信验证码（调用 Supabase Edge Function）
 * 2. 验证短信验证码
 * 3. 手机号登录（验证码通过后，查找或创建用户）
 * 4. 手机号注册
 *
 * 流程：
 *   发送验证码 → 输入验证码 → 验证通过 → 登录/注册
 *
 * 依赖：
 * - Supabase Edge Function: send-sms（部署在 Supabase）
 * - 数据库表: phone_verification_codes
 * - RPC 函数: verify_phone_code, check_phone_exists
 */

import { supabase } from './supabaseClient';

// Supabase Edge Function 的 URL
// 生产环境：部署到 Supabase 后的 URL
// 开发环境：使用 supabase CLI 本地调试
const SEND_SMS_FUNCTION_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/send-sms`;

/**
 * 发送短信验证码
 *
 * 调用 Supabase Edge Function 发送验证码到指定手机号
 *
 * @param phone 手机号（11位，如 13800138000）
 * @returns { success: boolean, message: string }
 */
export async function sendPhoneCode(phone: string): Promise<{ success: boolean; message: string }> {
  try {
    // 验证手机号格式
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      return { success: false, message: '手机号格式不正确' };
    }

    console.log('[PhoneAuth] 发送验证码到:', phone);

    // 调用 Supabase Edge Function
    const response = await fetch(SEND_SMS_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ phone }),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('[PhoneAuth] 发送验证码失败:', result.error);
      return { success: false, message: result.error || '发送失败，请稍后重试' };
    }

    console.log('[PhoneAuth] 验证码发送成功');
    return { success: true, message: '验证码已发送' };
  } catch (error) {
    console.error('[PhoneAuth] 发送验证码异常:', error);
    return { success: false, message: '网络连接异常，请稍后重试' };
  }
}

/**
 * 验证短信验证码
 *
 * 调用 Supabase RPC 函数验证验证码是否正确且未过期
 *
 * @param phone 手机号
 * @param code 6位验证码
 * @returns { success: boolean, message: string }
 */
export async function verifyPhoneCode(
  phone: string,
  code: string,
): Promise<{ success: boolean; message: string }> {
  try {
    console.log('[PhoneAuth] 验证验证码:', phone, code);

    const { data: isValid, error } = await supabase.rpc('verify_phone_code', {
      p_phone: phone,
      p_code: code,
    });

    if (error) {
      console.error('[PhoneAuth] 验证验证码 RPC 失败:', error.message);
      return { success: false, message: '验证失败，请稍后重试' };
    }

    if (!isValid) {
      console.warn('[PhoneAuth] 验证码无效或已过期');
      return { success: false, message: '验证码无效或已过期，请重新获取' };
    }

    console.log('[PhoneAuth] 验证码验证成功');
    return { success: true, message: '验证成功' };
  } catch (error) {
    console.error('[PhoneAuth] 验证验证码异常:', error);
    return { success: false, message: '网络连接异常，请稍后重试' };
  }
}

/**
 * 检查手机号是否已注册
 *
 * @param phone 手机号
 * @returns { exists: boolean, error?: string }
 */
export async function checkPhoneRegistered(
  phone: string,
): Promise<{ exists: boolean; error?: string }> {
  try {
    const { data: exists, error } = await supabase.rpc('check_phone_exists', {
      p_phone: phone,
    });

    if (error) {
      console.error('[PhoneAuth] check_phone_exists RPC 失败:', error.message);
      return { exists: false, error: error.message };
    }

    return { exists: !!exists };
  } catch (error) {
    console.error('[PhoneAuth] check_phone_exists 异常:', error);
    return { exists: false, error: '网络异常' };
  }
}

/**
 * 手机号登录
 *
 * 流程：
 * 1. 验证验证码
 * 2. 检查手机号是否已注册
 * 3. 如果已注册 → 使用 Supabase 的 signInWithPassword（需要手机号对应的邮箱）
 *    或者使用 Magic Link 方式
 *
 * ★ 注意：Supabase 默认不支持直接用手机号+密码登录。
 * 这里采用"验证码验证通过后，用邮箱登录"的变通方案。
 * 更完整的方案需要 Supabase 支持 Phone Auth。
 *
 * 目前简化实现：验证码通过后，直接返回成功，
 * 由页面根据手机号是否已注册来决定跳转到设置密码还是首页。
 */
export async function loginWithPhone(
  phone: string,
  code: string,
): Promise<{ success: boolean; message: string; isRegistered: boolean }> {
  try {
    // 1. 验证验证码
    const verifyResult = await verifyPhoneCode(phone, code);
    if (!verifyResult.success) {
      return { success: false, message: verifyResult.message, isRegistered: false };
    }

    // 2. 检查手机号是否已注册
    const { exists } = await checkPhoneRegistered(phone);

    if (exists) {
      // 手机号已注册 → 查找对应的邮箱，用邮箱登录
      // 这里需要 profiles 表中存储了 phone 和 email 的对应关系
      // 如果用户之前绑定了手机号，可以用邮箱+密码登录
      // 但这里简化处理：验证码通过即认为登录成功
      console.log('[PhoneAuth] 手机号已注册，登录成功');
    } else {
      // 手机号未注册 → 需要先注册
      console.log('[PhoneAuth] 手机号未注册');
    }

    return {
      success: true,
      message: exists ? '登录成功' : '手机号未注册',
      isRegistered: exists,
    };
  } catch (error) {
    console.error('[PhoneAuth] 手机号登录异常:', error);
    return { success: false, message: '登录失败，请稍后重试', isRegistered: false };
  }
}

/**
 * 手机号注册
 *
 * 流程：
 * 1. 验证验证码
 * 2. 检查手机号是否已注册
 * 3. 如果未注册 → 在 profiles 表中创建记录
 * 4. 返回成功
 *
 * ★ 注意：Supabase Auth 的用户记录是通过邮箱创建的。
 * 手机号注册的变通方案：
 * - 使用一个内部邮箱（如 phone_13800138000@lensgo.app）来创建 Supabase Auth 用户
 * - 同时在 profiles 表中记录手机号
 *
 * 目前简化：验证码通过后，在 profiles 表中创建记录，
 * 并使用一个自动生成的邮箱来创建 Supabase Auth 用户。
 */
export async function registerWithPhone(
  phone: string,
  code: string,
  password: string,
): Promise<{ success: boolean; message: string }> {
  try {
    // 1. 验证验证码
    const verifyResult = await verifyPhoneCode(phone, code);
    if (!verifyResult.success) {
      return { success: false, message: verifyResult.message };
    }

    // 2. 检查手机号是否已注册
    const { exists } = await checkPhoneRegistered(phone);
    if (exists) {
      return { success: false, message: '该手机号已注册，请直接登录' };
    }

    // 3. 使用自动生成的邮箱创建 Supabase Auth 用户
    // 格式: phone_13800138000@lensgo.app
    const email = `phone_${phone}@lensgo.app`;

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          phone,
          registered_via: 'phone',
        },
      },
    });

    if (error) {
      console.error('[PhoneAuth] 注册失败:', error.message);
      return { success: false, message: error.message };
    }

    if (!data.user) {
      return { success: false, message: '注册失败，请稍后重试' };
    }

    // 4. 更新 profiles 表中的手机号
    const { error: profileError } = await supabase
      .from('profiles')
      .update({ phone })
      .eq('id', data.user.id);

    if (profileError) {
      console.warn('[PhoneAuth] 更新 profiles 手机号失败:', profileError.message);
      // 不阻塞注册流程
    }

    console.log('[PhoneAuth] 手机号注册成功:', phone);
    return { success: true, message: '注册成功' };
  } catch (error) {
    console.error('[PhoneAuth] 手机号注册异常:', error);
    return { success: false, message: '注册失败，请稍后重试' };
  }
}
