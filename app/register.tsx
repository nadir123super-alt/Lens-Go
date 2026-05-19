/**
 * RegisterScreen — 注册页面
 *
 * 流程：
 * 1. 用户输入邮箱 → 点击"获取验证码" → signInWithOtp 发送验证码
 * 2. 用户输入验证码 + 设置密码 → 点击"注册" → signUp 创建账号
 * 3. 注册成功 → 自动登录 → 跳转首页
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
import { supabase } from '../services/supabaseClient';

export default function RegisterScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { refreshAuthState } = useAuth();

  const [email, setEmail] = useState('');
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

  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
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
    if (!email.trim() || !validateEmail(email)) {
      Alert.alert('提示', '请输入正确的邮箱格式');
      return;
    }

    setIsSendingCode(true);
    try {
      const trimmedEmail = email.trim().toLowerCase();

      // 先检查邮箱是否已注册
      const { data: existsData, error: existsError } = await supabase.rpc('check_email_exists', {
        email_to_check: trimmedEmail,
      });

      if (!existsError && existsData === true) {
        Alert.alert('该账号已存在', '该邮箱已注册，请直接登录', [
          { text: '前往登录', onPress: () => router.replace('/login') },
          { text: '取消', style: 'cancel' },
        ]);
        return;
      }

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

      Alert.alert('验证码已发送', `验证码已发送至 ${trimmedEmail}，请查收邮件（注意检查垃圾邮件箱）`);
    } catch (error) {
      Alert.alert('发送失败', '网络连接异常，请稍后重试');
    } finally {
      setIsSendingCode(false);
    }
  };

  /** 注册 */
  const handleSignup = async () => {
    if (!email.trim() || !validateEmail(email)) {
      Alert.alert('提示', '请输入正确的邮箱格式');
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
      const trimmedEmail = email.trim().toLowerCase();

      // 先检查邮箱是否已注册（双重保险，防止 handleSendCode 中的检查被跳过）
      const { data: existsData, error: existsError } = await supabase.rpc('check_email_exists', {
        email_to_check: trimmedEmail,
      });

      if (!existsError && existsData === true) {
        Alert.alert('该账号已存在', '该邮箱已注册，请直接登录', [
          { text: '前往登录', onPress: () => router.replace('/login') },
          { text: '取消', style: 'cancel' },
        ]);
        return;
      }

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

      // 验证码正确后，用邮箱 + 密码注册
      const { data, error } = await supabase.auth.signUp({
        email: trimmedEmail,
        password,
        options: {
          // 关闭邮箱确认后，data.user?.email_confirmed_at 会自动填充
          // 这里不传 emailRedirectTo，避免触发邮件
        },
      });

      if (error) {
        if (error.message === 'User already registered') {
          Alert.alert('该账号已存在', '该邮箱已注册，请直接登录', [
            { text: '前往登录', onPress: () => router.replace('/login') },
            { text: '取消', style: 'cancel' },
          ]);
          return;
        }
        Alert.alert('注册失败', translateAuthError(error.message));
        return;
      }

      if (data?.user?.identities?.length === 0) {
        Alert.alert('该账号已存在', '该邮箱已注册，请直接登录', [
          { text: '前往登录', onPress: () => router.replace('/login') },
          { text: '取消', style: 'cancel' },
        ]);
        return;
      }

      console.log('[Register] 注册成功，自动登录');

      // 注册成功后，Supabase 会自动创建 session（当关闭邮箱确认时）
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
        {/* 邮箱输入 */}
        <View style={s.inputContainer}>
          <Text style={s.label}>邮箱</Text>
          <View style={s.inputWrapper}>
            <Feather name="mail" size={18} color="#666" />
            <TextInput
              style={s.input}
              placeholder="请输入邮箱"
              placeholderTextColor="#666666"
              value={email}
              onChangeText={(text) => {
                setEmail(text);
                if (codeSent) {
                  setCodeSent(false);
                  setCode('');
                  if (timerRef.current) clearInterval(timerRef.current);
                  setCountdown(0);
                }
              }}
              keyboardType="email-address"
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
