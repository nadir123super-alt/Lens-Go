/**
 * LoginScreen — 登录页面（密码登录）
 *
 * 流程：
 * 1. 用户输入邮箱 + 密码 → 点击"登录" → signInWithPassword 验证
 * 2. 验证成功 → 自动创建 session → 跳转首页
 */
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
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

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { refreshAuthState } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session) {
        await refreshAuthState();
      }
    });
    return () => subscription?.unsubscribe();
  }, []);

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

  const handleLogin = async () => {
    // 1. 输入验证
    if (!email.trim()) {
      Alert.alert('提示', '请输入邮箱');
      return;
    }
    if (!validateEmail(email)) {
      Alert.alert('提示', '邮箱格式不正确，请重新输入');
      return;
    }
    if (!password) {
      Alert.alert('提示', '请输入密码');
      return;
    }
    if (password.length < 8) {
      Alert.alert('提示', '密码长度至少为 8 位');
      return;
    }

    setIsSubmitting(true);
    try {
      const trimmedEmail = email.trim().toLowerCase();

      // 2. 先检查账号是否存在（通过 RPC 函数查询 auth.users）
      console.log('[Login] 检查账号是否存在:', trimmedEmail);
      const { data: emailExists, error: checkError } = await supabase.rpc(
        'check_email_exists',
        { email_to_check: trimmedEmail },
      );

      if (checkError) {
        // RPC 调用失败（可能函数尚未创建），回退到直接登录
        console.warn('[Login] check_email_exists RPC 调用失败，回退到直接登录:', checkError.message);
      }

      // 3. 如果 RPC 返回 false（账号不存在），提示用户去注册
      if (emailExists === false) {
        console.log('[Login] 账号不存在:', trimmedEmail);
        setPassword('');
        Alert.alert(
          '账号不存在',
          '该邮箱尚未注册，请先注册账号。',
          [
            { text: '重新输入', style: 'cancel' },
            { text: '去注册', onPress: () => router.push('/register') },
          ],
        );
        return;
      }

      // 4. 账号存在，验证密码
      console.log('[Login] 账号存在，验证密码');
      const { data, error } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });

      if (error) {
        if (error.message === 'Invalid login credentials') {
          // 此时已确认账号存在，所以一定是密码错误
          setPassword('');
          Alert.alert('登录失败', '密码或账号错误，请重新输入');
        } else if (error.message === 'Email not confirmed') {
          Alert.alert('邮箱未验证', '请先查收验证邮件并点击确认链接，然后再登录');
        } else {
          Alert.alert('登录失败', translateAuthError(error.message));
        }
        return;
      }

      console.log('[Login] 登录成功');
      router.replace('/(tabs)');
      refreshAuthState();
    } catch (error) {
      Alert.alert('网络连接异常', '网络连接异常，请稍后再试');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email.trim() || !validateEmail(email)) {
      Alert.alert('提示', '请输入正确的邮箱格式');
      return;
    }

    setIsSubmitting(true);
    try {
      const trimmedEmail = email.trim().toLowerCase();
      const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail);

      if (error) {
        if (error.message === 'User not found') {
          Alert.alert('重置失败', '该邮箱尚未注册，请先注册账号');
        } else {
          Alert.alert('重置密码失败', translateAuthError(error.message));
        }
      } else {
        Alert.alert(
          '重置链接已发送',
          `已向 ${trimmedEmail} 发送密码重置链接，请查收邮件并点击链接完成密码修改。`,
        );
        setEmail('');
      }
    } catch (error) {
      Alert.alert('操作失败', '网络连接异常，请稍后重试');
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
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>
        </View>

        {/* 密码输入 */}
        <View style={s.inputContainer}>
          <Text style={s.label}>密码</Text>
          <View style={s.inputWrapper}>
            <Feather name="lock" size={18} color="#666" />
            <TextInput
              style={s.input}
              placeholder="请输入密码"
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

        {/* 忘记密码 */}
        <TouchableOpacity onPress={handleForgotPassword} style={s.forgotBtn}>
          <Text style={s.forgotText}>忘记密码？</Text>
        </TouchableOpacity>

        {/* 登录按钮 */}
        <View style={s.mainBtnWrapper}>
          <TouchableOpacity onPress={handleLogin} style={s.mainBtn} disabled={isSubmitting}>
            {isSubmitting ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={s.mainBtnText}>密码登录</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* 前往注册 */}
        <View style={s.switchRow}>
          <Text style={s.switchText}>还没有账号？</Text>
          <TouchableOpacity onPress={() => router.push('/register')}>
            <Text style={s.switchLink}>立即注册</Text>
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
  forgotBtn: {
    alignSelf: 'flex-end',
    marginTop: 4,
  },
  forgotText: {
    fontSize: 13,
    color: '#FF6B6B',
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
