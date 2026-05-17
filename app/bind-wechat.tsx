/**
 * BindWechatScreen — 绑定微信页面
 */
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import {
  Alert,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { supabase } from '../services/supabaseClient';

export default function BindWechatScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [isBinding, setIsBinding] = useState(false);

  // 模拟微信授权绑定
  const handleBind = async () => {
    setIsBinding(true);

    // 模拟微信授权流程
    await new Promise(resolve => setTimeout(resolve, 2000));

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // 更新数据库
      await supabase
        .from('profiles')
        .update({ wechat: '微信用户' })
        .eq('id', user.id);

      Alert.alert('成功', '微信绑定成功', [
        {
          text: '确定',
          onPress: () => {
            router.back();
          },
        },
      ]);
    } catch (error) {
      console.warn('[BindWechat] 绑定失败:', error);
      Alert.alert('错误', '绑定失败，请重试');
    } finally {
      setIsBinding(false);
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
        <Text style={s.headerTitle}>绑定微信</Text>
        <View style={s.headerBtn} />
      </View>

      {/* 内容区域 */}
      <View style={s.content}>
        {/* 微信图标 */}
        <View style={s.iconWrapper}>
          <View style={s.iconBg}>
            <Feather name="message-circle" size={60} color="#34C759" />
          </View>
        </View>

        <Text style={s.title}>绑定微信账号</Text>
        <Text style={s.desc}>绑定后可使用微信快捷登录</Text>

        {/* 绑定按钮 */}
        <TouchableOpacity
          onPress={handleBind}
          style={s.bindBtn}
          disabled={isBinding}
        >
          <Feather name="message-circle" size={24} color="#FFFFFF" />
          <Text style={s.bindBtnText}>
            {isBinding ? '绑定中...' : '绑定微信'}
          </Text>
        </TouchableOpacity>

        <Text style={s.tip}>绑定即表示同意《用户协议》和《隐私政策》</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#1a1a1a',
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
    flex: 1,
    alignItems: 'center',
    padding: 20,
    justifyContent: 'center',
  },
  iconWrapper: {
    marginBottom: 30,
  },
  iconBg: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#2a2a2a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 12,
  },
  desc: {
    fontSize: 14,
    color: '#999',
    marginBottom: 40,
  },
  bindBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#34C759',
    borderRadius: 30,
    paddingHorizontal: 40,
    paddingVertical: 16,
  },
  bindBtnText: {
    fontSize: 18,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  tip: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
    marginTop: 40,
  },
});
