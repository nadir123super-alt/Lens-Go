/**
 * RegisterScreen — 注册页面
 *
 * 支持：
 * - 邮箱注册：输入邮箱 → 获取验证码（signInWithOtp）→ 验证验证码 → 设置密码
 * - 手机号注册：输入手机号 → 获取短信验证码（Edge Function）→ 验证验证码 → 设置密码
 *
 * ★ 注意（邮箱）：signInWithOtp({ shouldCreateUser: true }) 会在发送验证码时自动创建用户记录。
 * 因此后续不能再调用 signUp()（会报 "User already registered"），
 * 而是直接 verifyOtp → updateUser({ password }) 设置密码。
 *
 * ★ 注意（手机号）：使用 phoneAuthService 的 sendPhoneCode / registerWithPhone，
 * 通过 Supabase Edge Function 发送短信，验证码通过后创建用户。
 */
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AppLogo from '../components/AppLogo';
import { useAuth } from '../services/AuthContext';
import { registerWithPhone, sendPhoneCode } from '../services/phoneAuthService';
import { supabase } from '../services/supabaseClient';

export default function RegisterScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { refreshAuthState } = useAuth();

  const [account, setAccount] = useState(''); // 手机号或邮箱
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 记录倒计时结束的时间戳（毫秒），用于组件重新挂载时恢复剩余时间
  const countdownEndRef = useRef<number>(0);

  // 组件卸载时清除定时器；重新挂载时如果倒计时未结束则恢复
  useEffect(() => {
    return () => {
      // 组件卸载时清除定时器
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  // 单独监听 countdown 变化，当倒计时结束时清除定时器
  useEffect(() => {
    if (countdown <= 0 && timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, [countdown]);

  /** 判断输入是否为邮箱 */
  const isEmail = (value: string): boolean => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  };

  /** 判断输入是否为手机号 */
  const isPhone = (value: string): boolean => {
    return /^1[3-9]\d{9}$/.test(value);
  };

  const translateAuthError = (message: string): string => {
    const errorMap: Record<string, string> = {
      'Invalid login credentials': '邮箱或密码错误，请重新输入',
      'Email not confirmed': '邮箱尚未验证，请先查收验证邮件',
      'User already registered': '该邮箱已注册，请直接登录',
      'Invalid email': '邮箱格式不正确',
      'Password should be at least 8 characters': '密码长度至少为 8 位',
      'Signup requires a valid password': '请设置有效的密码（至少8位）',
      'Email rate limit exceeded': '发送过于频繁，请稍后再试',
    };
    return errorMap[message] || message;
  };

  /** 发送验证码 */
  const handleSendCode = async () => {
    const trimmed = account.trim();

    if (!trimmed) {
      Alert.alert('提示', '请输入手机号或邮箱');
      return;
    }

    const isEmailInput = isEmail(trimmed);
    const isPhoneInput = isPhone(trimmed);

    if (!isEmailInput && !isPhoneInput) {
      Alert.alert('提示', '请输入正确的手机号或邮箱格式');
      return;
    }

    setIsSendingCode(true);
    try {
      if (isEmailInput) {
        // === 邮箱验证码 ===
        const trimmedEmail = trimmed.toLowerCase();

        const { error } = await supabase.auth.signInWithOtp({
          email: trimmedEmail,
          options: {
            shouldCreateUser: true,
          },
        });

        if (error) {
          Alert.alert('发送失败', translateAuthError(error.message));
          return;
        }

        Alert.alert('验证码已发送', `验证码已发送至 ${trimmedEmail}，请查收邮件（注意检查垃圾邮件箱）`);
      } else {
        // === 手机号短信验证码 ===
        const result = await sendPhoneCode(trimmed);

        if (!result.success) {
          Alert.alert('发送失败', result.message);
          return;
        }

        Alert.alert('验证码已发送', `短信验证码已发送至 ${trimmed}，请注意查收`);
      }

      // 发送成功
      setCodeSent(true);
      // 记录倒计时结束时间戳（当前时间 + 60秒）
      countdownEndRef.current = Date.now() + 60_000;
      setCountdown(60);

      // 清除旧定时器（防止重复启动）
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }

      timerRef.current = setInterval(() => {
        const remaining = Math.max(0, Math.round((countdownEndRef.current - Date.now()) / 1000));
        setCountdown(remaining);
        if (remaining <= 0 && timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      }, 1000);
    } catch (error) {
      Alert.alert('发送失败', '网络连接异常，请稍后重试');
    } finally {
      setIsSendingCode(false);
    }
  };

  /** 注册 */
  const handleSignup = async () => {
    const trimmed = account.trim();

    if (!trimmed) {
      Alert.alert('提示', '请输入手机号或邮箱');
      return;
    }

    const isEmailInput = isEmail(trimmed);
    const isPhoneInput = isPhone(trimmed);

    if (!isEmailInput && !isPhoneInput) {
      Alert.alert('提示', '请输入正确的手机号或邮箱格式');
      return;
    }

    if (!code.trim()) {
      Alert.alert('提示', '请输入验证码');
      return;
    }
    if (!password) {
      Alert.alert('提示', '请设置密码');
      return;
    }
    if (password.length < 8) {
      Alert.alert('提示', '密码长度至少为 8 位');
      return;
    }

    setIsSubmitting(true);
    try {
      if (isEmailInput) {
        // === 邮箱注册流程 ===
        const trimmedEmail = trimmed.toLowerCase();

        // 验证验证码
        const { error: verifyError } = await supabase.auth.verifyOtp({
          email: trimmedEmail,
          token: code.trim(),
          type: 'email',
        });

        if (verifyError) {
          if (verifyError.message === 'Token has expired or is invalid') {
            Alert.alert('验证码无效', '验证码已过期或错误，请重新获取');
          } else {
            Alert.alert('验证失败', translateAuthError(verifyError.message));
          }
          return;
        }

        // 验证码正确 → 用户已自动登录（有 session）
        // 检查用户是否已有密码（即之前已完成注册）
        const { data: hasPassword, error: checkPwdError } = await supabase.rpc(
          'check_user_has_password',
          { email_to_check: trimmedEmail },
        );

        if (!checkPwdError && hasPassword === true) {
          // 用户已有密码，说明已完成注册，引导去登录
          console.log('[Register] 用户已有密码，引导登录');
          Alert.alert('该账号已存在', '该邮箱已注册，请直接登录', [
            { text: '前往登录', onPress: () => router.replace('/login') },
            { text: '取消', style: 'cancel' },
          ]);
          return;
        }

        // 用户没有密码，设置密码完成注册
        console.log('[Register] 验证码正确，设置密码');
        const { error: updateError } = await supabase.auth.updateUser({
          password,
        });

        if (updateError) {
          console.error('[Register] 设置密码失败:', updateError.message);
          Alert.alert('设置密码失败', translateAuthError(updateError.message));
          return;
        }

        console.log('[Register] 注册成功，自动登录');
      } else {
        // === 手机号注册流程 ===
        const result = await registerWithPhone(trimmed, code.trim(), password);

        if (!result.success) {
          Alert.alert('注册失败', result.message);
          return;
        }

        console.log('[Register] 手机号注册成功');
      }

      // 注册成功，跳转首页
      router.replace('/(tabs)');
      refreshAuthState();
    } catch (error) {
      Alert.alert('注册失败', '注册异常，请稍后重试');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[s.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <StatusBar style="light" />

      {/* Logo 和标题区域 */}
      <View style={s.header}>
        <AppLogo size={80} />
        <Text style={s.appName}>Lens Go</Text>
      </View>

      {/* 表单区域 */}
      <View style={s.form}>
        {/* 邮箱/手机号输入 */}
        <View style={s.inputContainer}>
          <Text style={s.label}>邮箱/手机号</Text>
          <View style={s.inputWrapper}>
            <Feather name="mail" size={18} color="#666" />
            <TextInput
              style={s.input}
              placeholder="请输入邮箱或手机号"
              placeholderTextColor="#666666"
              value={account}
              onChangeText={(text) => {
                setAccount(text);
                if (codeSent) {
                  setCodeSent(false);
                  setCode('');
                  if (timerRef.current) clearInterval(timerRef.current);
                  setCountdown(0);
                }
              }}
              keyboardType={isPhone(account) ? 'phone-pad' : 'email-address'}
              autoCapitalize="none"
            />
          </View>
        </View>

        {/* 验证码输入 */}
        <View style={s.inputContainer}>
          <Text style={s.label}>验证码</Text>
          <View style={s.codeRow}>
            <View style={[s.inputWrapper, s.codeInputWrapper]}>
              <Feather name="shield" size={18} color="#666" />
              <TextInput
                style={s.input}
                placeholder="请输入验证码"
                placeholderTextColor="#666666"
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                maxLength={6}
              />
            </View>
            <TouchableOpacity
              style={[s.sendCodeBtn, (isSendingCode || countdown > 0) && s.sendCodeBtnDisabled]}
              onPress={handleSendCode}
              disabled={isSendingCode || countdown > 0}
              activeOpacity={0.7}
            >
              {isSendingCode ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : countdown > 0 ? (
                <Text style={s.sendCodeBtnText}>{countdown}s</Text>
              ) : (
                <Text style={s.sendCodeBtnText}>获取验证码</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* 密码输入 */}
        <View style={s.inputContainer}>
          <Text style={s.label}>密码</Text>
          <View style={s.inputWrapper}>
            <Feather name="lock" size={18} color="#666" />
            <TextInput
              style={s.input}
              placeholder="请设置密码（至少8位）"
              placeholderTextColor="#666666"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
            />
            <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={s.toggleBtn}>
              <Feather name={showPassword ? 'eye' : 'eye-off'} size={18} color="#666" />
            </TouchableOpacity>
          </View>
        </View>

        {/* 注册按钮 */}
        <View style={s.mainBtnWrapper}>
          <TouchableOpacity onPress={handleSignup} style={s.mainBtn} disabled={isSubmitting}>
            {isSubmitting ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={s.mainBtnText}>注册</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* 返回登录 */}
        <View style={s.switchRow}>
          <Text style={s.switchText}>已有账号？</Text>
          <TouchableOpacity onPress={() => router.push('/login')}>
            <Text style={s.switchLink}>密码登录</Text>
          </TouchableOpacity>
        </View>

      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 24,
  },
  header: {
    alignItems: 'center',
    marginTop: 40,
    marginBottom: 28,
  },
  logo: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#2a2a2a',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  appName: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 6,
  },
  slogan: {
    fontSize: 13,
    color: '#999',
  },
  form: {
    paddingBottom: 40,
  },
  inputContainer: {
    marginBottom: 12,
  },
  label: {
    fontSize: 14,
    color: '#FFFFFF',
    marginBottom: 4,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 50,
  },
  input: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 15,
    marginLeft: 10,
  },
  toggleBtn: {
    padding: 8,
  },
  /** 验证码行：输入框 + 发送按钮 */
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  codeInputWrapper: {
    flex: 1,
  },
  sendCodeBtn: {
    backgroundColor: '#FF6B6B',
    borderRadius: 12,
    height: 50,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 100,
  },
  sendCodeBtnDisabled: {
    backgroundColor: '#555',
  },
  sendCodeBtnText: {
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  mainBtnWrapper: {
    marginTop: 28,
  },
  mainBtn: {
    backgroundColor: '#FF6B6B',
    borderRadius: 12,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mainBtnText: {
    fontSize: 17,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 16,
  },
  switchText: {
    fontSize: 13,
    color: '#999',
  },
  switchLink: {
    fontSize: 13,
    color: '#FF6B6B',
    fontWeight: '600',
  },
});
