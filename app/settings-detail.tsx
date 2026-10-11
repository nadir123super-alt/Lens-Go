/**
 * SettingsDetailScreen — 独立设置详情页（无底部导航栏）
 * 
 * 功能：
 * 1. 个人资料编辑（头像、昵称）
 * 2. 账号绑定展示（邮箱）
 * 3. 退出登录 / 注销账号
 * 
 * 路由：主 Stack 导航器，非 Tab 导航
 */
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import UserAvatar from '../components/UserAvatar';
import { useAuth } from '../services/AuthContext';
import { supabase } from '../services/supabaseClient';

const ANCHOR_COLOR = '#FF6B6B';

export default function SettingsDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signOut } = useAuth();

  const [userId, setUserId] = useState<string>('');
  const [avatarType, setAvatarType] = useState<number>(0);
  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);

  // 加载用户信息
  useEffect(() => {
    loadUserProfile();
  }, []);

  // 使用 useFocusEffect 监听页面聚焦，返回时重新加载数据
  useFocusEffect(
    useCallback(() => {
      loadUserProfile();
    }, [])
  );

  const loadUserProfile = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      setUserId(user.id);

      const { data: profile } = await supabase
        .from('profiles')
        .select('avatar_type, nickname, email')
        .eq('id', user.id)
        .single();

      if (profile) {
        setAvatarType(profile.avatar_type || 0);
        setNickname(profile.nickname || '英语学习者');
        setEmail(profile.email || user.email || '');
      }
    } catch (error) {
      console.warn('[SettingsDetail] 加载用户信息失败:', error);
    }
  };

  // 修改昵称 - 跳转到编辑页面
  const handleNicknameChange = () => {
    router.push('/edit-nickname');
  };

  // 退出登录
  const handleLogout = async () => {
    Alert.alert(
      '确认退出',
      '确定要退出登录吗？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '退出',
          style: 'destructive',
          onPress: async () => {
            try {
              await signOut();
            } catch (error) {
              console.warn('[SettingsDetail] 退出登录失败:', error);
            }
          },
        },
      ]
    );
  };

  // 注销账号
  const handleDeleteAccount = async () => {
    Alert.alert(
      '危险操作',
      '注销后将永久删除所有学习记录，且无法找回。确定注销吗？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确认注销',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              // 调用 RPC 函数删除用户
              const { error } = await supabase.rpc('delete_user_self');
              
              if (error) {
                throw error;
              }

              // 清除本地缓存并跳转（使用集中式 signOut）
              await signOut();
            } catch (error) {
              console.error('[SettingsDetail] 注销账号失败:', error);
              Alert.alert('错误', '注销失败，请稍后重试或联系客服');
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      {/* 顶部导航 */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Feather name="arrow-left" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>设置</Text>
        <View style={s.backBtn}>
          {loading && <ActivityIndicator size="small" color="#FF6B6B" />}
        </View>
      </View>

      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>
        {/* 个人资料卡片 */}
        <View style={s.card}>
          <View style={s.sectionTitleRow}>
            <Feather name="user" size={18} color={ANCHOR_COLOR} />
            <Text style={s.sectionTitle}>个人资料</Text>
          </View>

          {/* 头像 — ScrapLab 专属数字形象 */}
          <View style={s.avatarRow}>
            {userId && avatarType > 0 ? (
              <UserAvatar userId={userId} avatarType={avatarType} size={80} />
            ) : (
              <View style={s.avatarWrapper}>
                <View style={s.avatarPlaceholder}>
                  <Feather name="user" size={40} color="#FFFFFF" />
                </View>
              </View>
            )}
            <View style={s.avatarInfo}>
              <Text style={s.avatarLabel}>头像</Text>
              <Text style={s.avatarHint}>你的专属数字形象</Text>
            </View>
          </View>

          <View style={s.divider} />
          {/* 昵称 */}
          <TouchableOpacity
            style={s.row}
            onPress={handleNicknameChange}
            activeOpacity={0.7}
          >
            <Feather name="edit-3" size={18} color="#4A90D9" />
            <Text style={s.rowLabel}>昵称</Text>
            <Text style={s.rowValue}>{nickname}</Text>
            <Feather name="chevron-right" size={20} color="#666" />
          </TouchableOpacity>
        </View>

        {/* 账号绑定卡片 - 仅保留邮箱 */}
        <View style={s.card}>
          <View style={s.sectionTitleRow}>
            <Feather name="link" size={18} color="#34C759" />
            <Text style={s.sectionTitle}>账号绑定</Text>
          </View>

          {/* 邮箱 */}
          <TouchableOpacity
            style={s.row}
            activeOpacity={0.7}
          >
            <Feather name="mail" size={18} color="#4A90D9" />
            <Text style={s.rowLabel}>邮箱</Text>
            <Text style={s.rowValue}>{email || '未绑定'}</Text>
            <Feather name="chevron-right" size={20} color="#666" />
          </TouchableOpacity>
        </View>

        {/* 关于卡片 */}
        <View style={s.card}>
          <TouchableOpacity style={s.row} activeOpacity={0.7}>
            <Feather name="info" size={18} color="#888" />
            <Text style={s.rowLabel}>关于</Text>
            <Text style={s.rowValue}>LensGo v1.0.0</Text>
            <Feather name="chevron-right" size={20} color="#666" />
          </TouchableOpacity>
        </View>

        {/* 底部操作区 */}
        <View style={s.bottomActions}>
          <TouchableOpacity
            style={s.deleteBtn}
            onPress={handleDeleteAccount}
            activeOpacity={0.7}
          >
            <Text style={s.deleteText}>注销账号</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={s.logoutBtn}
            onPress={handleLogout}
            activeOpacity={0.7}
          >
            <Text style={s.logoutText}>退出登录</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: insets.bottom + 40 }} />
      </ScrollView>
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
  backBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  scroll: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 20,
  },
  card: {
    backgroundColor: '#2a2a2a',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginLeft: 8,
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarWrapper: {
    width: 80,
    height: 80,
    borderRadius: 40,
    overflow: 'hidden',
    backgroundColor: '#2a2a2a',
  },
  avatarPlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2a2a2a',
  },
  avatarInfo: {
    flex: 1,
    marginLeft: 16,
  },
  avatarLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  avatarHint: {
    fontSize: 12,
    color: '#999',
    marginTop: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  rowLabel: {
    flex: 1,
    fontSize: 16,
    color: '#FFFFFF',
    marginLeft: 12,
  },
  rowValue: {
    fontSize: 16,
    color: '#999',
    marginRight: 8,
  },
  divider: {
    height: 1,
    backgroundColor: '#2a2a2a',
    marginVertical: 8,
  },
  bottomActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
    marginTop: 16,
  },
  deleteBtn: {
    flex: 1,
    paddingVertical: 16,
    alignItems: 'center',
    borderRadius: 12,
    backgroundColor: '#2a2a2a',
  },
  deleteText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FF9595',
  },
  logoutBtn: {
    flex: 1,
    paddingVertical: 16,
    alignItems: 'center',
    borderRadius: 12,
    backgroundColor: '#2a2a2a',
  },
  logoutText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FF9595',
  },
});
