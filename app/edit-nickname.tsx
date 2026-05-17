/**
 * EditNicknameScreen — 修改昵称页面
 */
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useState, useEffect } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { supabase } from '../services/supabaseClient';

export default function EditNicknameScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [nickname, setNickname] = useState('');
  const [originalNickname, setOriginalNickname] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // 加载当前昵称
  useEffect(() => {
    loadCurrentNickname();
  }, []);

  const loadCurrentNickname = async () => {
    try {
      const { data: { user }, error } = await supabase.auth.getUser();
      
      if (error) {
        console.error('[EditNickname] 获取用户失败:', error);
        return;
      }

      if (!user) {
        console.warn('[EditNickname] 用户未登录');
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('nickname')
        .eq('id', user.id)
        .single();

      if (profileError) {
        console.warn('[EditNickname] 获取用户资料失败:', profileError);
        return;
      }

      if (profile?.nickname) {
        setNickname(profile.nickname);
        setOriginalNickname(profile.nickname);
      }
    } catch (error) {
      console.warn('[EditNickname] 加载昵称失败:', error);
    }
  };

  // 保存昵称
  const handleSave = async () => {
    console.log('[EditNickname] handleSave called');
    console.log('[EditNickname] nickname:', nickname);
    console.log('[EditNickname] originalNickname:', originalNickname);

    if (!nickname.trim()) {
      Alert.alert('提示', '昵称不能为空');
      return;
    }

    if (nickname.trim() === originalNickname) {
      Alert.alert('提示', '昵称未发生变化');
      return;
    }

    setIsSaving(true);
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      
      if (authError) {
        console.error('[EditNickname] 获取用户失败:', authError);
        Alert.alert('错误', '获取用户信息失败');
        return;
      }

      if (!user) {
        console.error('[EditNickname] 用户未登录');
        Alert.alert('提示', '请先登录', [
          {
            text: '确定',
            onPress: () => {
              router.replace('/login');
            },
          },
        ]);
        return;
      }

      console.log('[EditNickname] 用户ID:', user.id);

      const { error: updateError } = await supabase
        .from('profiles')
        .update({ nickname: nickname.trim() })
        .eq('id', user.id);

      if (updateError) {
        console.error('[EditNickname] 更新失败:', updateError);
        Alert.alert('错误', '更新失败: ' + updateError.message);
        return;
      }

      Alert.alert('成功', '昵称已更新', [
        {
          text: '确定',
          onPress: () => {
            router.back();
          },
        },
      ]);
    } catch (error) {
      console.error('[EditNickname] 保存昵称异常:', error);
      Alert.alert('错误', '保存失败，请重试');
    } finally {
      setIsSaving(false);
    }
  };

  // 清除输入
  const handleClear = () => {
    setNickname('');
  };

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      {/* 顶部导航 */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.headerBtn}>
          <Text style={s.headerBtnText}>取消</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>修改昵称</Text>
        <TouchableOpacity
          onPress={handleSave}
          style={s.headerBtn}
          disabled={isSaving}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color="#FF6B6B" />
          ) : (
            <Text style={s.headerBtnText}>保存</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* 输入区域 */}
      <View style={s.content}>
        <View style={s.inputWrapper}>
          <TextInput
            style={s.input}
            placeholder="请输入昵称"
            placeholderTextColor="#666"
            value={nickname}
            onChangeText={setNickname}
            maxLength={20}
            autoFocus
          />
          {nickname && (
            <TouchableOpacity onPress={handleClear} style={s.clearBtn}>
              <Feather name="x" size={18} color="#999" />
            </TouchableOpacity>
          )}
        </View>
        <Text style={s.hint}>昵称长度不超过20个字符</Text>
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
    width: 60,
    alignItems: 'center',
    paddingVertical: 8,
  },
  headerBtnText: {
    fontSize: 16,
    color: '#FF6B6B',
    fontWeight: '600',
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
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 48,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#FFFFFF',
  },
  clearBtn: {
    padding: 8,
  },
  hint: {
    fontSize: 12,
    color: '#666',
    marginTop: 12,
  },
});
