/**
 * BindEmailScreen — 绑定邮箱页面
 */
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import {
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { supabase } from '../services/supabaseClient';

export default function BindEmailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 验证邮箱格式
  const isValidEmail = (email: string) => {
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return regex.test(email);
  };

  // 发送验证码
  const handleSendCode = () => {
    if (!email || !isValidEmail(email)) {
      Alert.alert('提示', '请输入正确的邮箱地址');
      return;
    }

    // 模拟发送验证码
    setCountdown(60);
    Alert.alert('提示', '验证码已发送至您的邮箱（模拟）');

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // 提交绑定
  const handleSubmit = async () => {
    if (!email || !isValidEmail(email)) {
      Alert.alert('提示', '请输入正确的邮箱地址');
      return;
    }

    if (!code || code.length !== 6) {
      Alert.alert('提示', '请输入6位验证码');
      return;
    }

    setIsSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // 更新数据库
      await supabase
        .from('profiles')
        .update({ email })
        .eq('id', user.id);

      Alert.alert('成功', '邮箱绑定成功', [
        {
          text: '确定',
          onPress: () => {
            router.back();
          },
        },
      ]);
    } catch (error) {
      console.warn('[BindEmail] 绑定失败:', error);
      Alert.alert('错误', '绑定失败，请重试');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      {/* 顶部导航 */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.headerBtn}>
          <Feather name="arrow-left" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>绑定邮箱</Text>
        <View style={s.headerBtn} />
      </View>

      {/* 内容区域 */}
      <View style={s.content}>
        {/* 邮箱输入 */}
        <View style={s.inputItem}>
          <Text style={s.label}>邮箱</Text>
          <View style={s.inputWrapper}>
            <TextInput
              style={s.input}
              placeholder="请输入邮箱地址"
              placeholderTextColor="#666"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>
        </View>

        {/* 验证码输入 */}
        <View style={s.inputItem}>
          <Text style={s.label}>验证码</Text>
          <View style={s.inputRow}>
            <View style={s.inputWrapper}>
              <TextInput
                style={s.input}
                placeholder="请输入验证码"
                placeholderTextColor="#666"
                value={code}
                onChangeText={setCode}
                keyboardType="numeric"
                maxLength={6}
              />
            </View>
            <TouchableOpacity
              onPress={handleSendCode}
              style={[s.codeBtn, countdown > 0 && s.codeBtnDisabled]}
              disabled={countdown > 0}
            >
              <Text style={s.codeBtnText}>
                {countdown > 0 ? `${countdown}s` : '发送验证码'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 提交按钮 */}
        <TouchableOpacity
          onPress={handleSubmit}
          style={s.submitBtn}
          disabled={isSubmitting}
        >
          <Text style={s.submitBtnText}>{isSubmitting ? '绑定中...' : '绑定'}</Text>
        </TouchableOpacity>

        <Text style={s.tip}>绑定后可用于账号找回和安全验证</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#000000',
    borderBottomWidth: 1,
    borderBottomColor: '#1E1E1E',
  },
  headerBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  content: {
    padding: 20,
    marginTop: 20,
  },
  inputItem: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    color: '#FFFFFF',
    marginBottom: 8,
  },
  inputWrapper: {
    backgroundColor: '#1E1E1E',
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 48,
    justifyContent: 'center',
  },
  input: {
    fontSize: 16,
    color: '#FFFFFF',
  },
  inputRow: {
    flexDirection: 'row',
    gap: 12,
  },
  codeBtn: {
    flex: 1,
    backgroundColor: '#FF6B6B',
    borderRadius: 12,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeBtnDisabled: {
    backgroundColor: '#444',
  },
  codeBtnText: {
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  submitBtn: {
    backgroundColor: '#FF6B6B',
    borderRadius: 12,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
  },
  submitBtnText: {
    fontSize: 16,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  tip: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
    marginTop: 16,
  },
});
