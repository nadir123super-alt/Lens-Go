/**
 * RegisterScreen — 注册页面
 */
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
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

import { useAuth } from '../services/AuthContext';
import { supabase } from '../services/supabaseClient';

export default function RegisterScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { refreshAuthState } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  const handleSignup = async () => {
    if (!email.trim() || !validateEmail(email)) {
      Alert.alert('提示', '请输入正确的邮箱格式');
      return;
    }
    if (!password) {
      Alert.alert('提示', '请输入密码');
      return;
    }
    if (password.length < 6) {
      Alert.alert('提示', '密码长度至少为 6 位');
      return;
    }

    setIsSubmitting(true);
    try {
      const trimmedEmail = email.trim().toLowerCase();
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
      // 直接跳转首页，AuthContext 的 onAuthStateChange 会处理后续状态
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
        <View style={s.logo}>
          <Feather name="book-open" size={60} color="#FF6B6B" />
        </View>
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
              placeholder="请设置密码（至少6位）"
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
          <TouchableOpacity onPress={() => router.replace('/login')}>
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
    backgroundColor: '#000000',
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
    backgroundColor: '#1E1E1E',
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
    backgroundColor: '#1E1E1E',
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
