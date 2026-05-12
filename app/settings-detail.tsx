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
import { decode } from 'base64-arraybuffer';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { supabase } from '../services/supabaseClient';

const ANCHOR_COLOR = '#FF6B6B';

export default function SettingsDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
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

      const { data: profile } = await supabase
        .from('profiles')
        .select('avatar_url, nickname, email')
        .eq('id', user.id)
        .single();

      if (profile) {
        setAvatarUrl(profile.avatar_url || null);
        setNickname(profile.nickname || '英语学习者');
        setEmail(profile.email || user.email || '');
      }
    } catch (error) {
      console.warn('[SettingsDetail] 加载用户信息失败:', error);
    }
  };

  // 选择头像
  const handleAvatarChange = async () => {
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissionResult.granted) {
      Alert.alert('权限不足', '请在设置中开启相册权限');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.5,
    });

    if (!result.canceled && result.assets.length > 0) {
      const uri = result.assets[0].uri;
      await uploadAvatar(uri);
    }
  };

  // 上传头像
  const uploadAvatar = async (uri: string) => {
    // ============================================================
    // 调试：检查当前认证状态
    // ============================================================
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    console.log('[SettingsDetail] 当前 Session:', session ? `有效 (user: ${session.user.id})` : '无效');
    if (sessionError) {
      console.warn('[SettingsDetail] 获取 Session 失败:', sessionError);
    }

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    console.log('[SettingsDetail] 当前用户:', user ? user.id : '未登录');
    if (userError) {
      console.warn('[SettingsDetail] 获取用户失败:', userError);
    }

    if (!user) {
      Alert.alert('未登录', '请先登录后再上传头像');
      return;
    }

    setLoading(true);
    try {
      // 获取旧头像文件名（用于后续删除）
      const oldAvatarUrl = avatarUrl;
      const oldFileName = oldAvatarUrl ? oldAvatarUrl.split('/').pop() : null;

      // 生成新文件名：{userId}/{timestamp}_{random}.png
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(2, 9);
      const fileName = `${user.id}/${timestamp}_${random}.png`;

      // ============================================================
      // 使用 expo-file-system 读取 base64，然后用 base64-arraybuffer
      // 解码为 ArrayBuffer 上传到 Supabase Storage。
      //
      // 为什么用 ArrayBuffer？
      // Supabase JS SDK 官方文档明确指出：
      //   "For React Native, using either Blob, File or FormData does
      //    not work as intended. Upload file using ArrayBuffer from
      //    base64 file data instead"
      // （参见 SDK 源码 upload 方法的 @remarks 注释）
      //
      // 使用 ArrayBuffer 时，SDK 会走 else 分支（第 605-610 行），
      // 直接发送原始二进制数据并设置 content-type 头。
      // ============================================================
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      // 使用 base64-arraybuffer 库解码为 ArrayBuffer
      const arrayBuffer = decode(base64);

      console.log('[SettingsDetail] 准备上传文件:', {
        fileName,
        size: arrayBuffer.byteLength,
        type: 'image/png',
      });

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(fileName, arrayBuffer, {
          contentType: 'image/png',
          upsert: true,
        });

      if (uploadError) {
        throw uploadError;
      }

      console.log('[SettingsDetail] 文件上传成功:', fileName);

      // 获取公开 URL
      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(fileName);

      // 更新数据库
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: publicUrl })
        .eq('id', user.id);

      if (updateError) {
        // 如果数据库更新失败，尝试删除已上传的文件
        await supabase.storage.from('avatars').remove([fileName]).catch(() => {});
        throw updateError;
      }

      // 清理旧文件（如果存在）
      if (oldFileName && oldFileName !== fileName) {
        await supabase.storage.from('avatars').remove([oldFileName]).catch((e) => {
          console.warn('[SettingsDetail] 删除旧头像失败:', e);
        });
      }

      // 更新前端状态
      setAvatarUrl(publicUrl);
      Alert.alert('成功', '头像已更新');
    } catch (error) {
      console.warn('[SettingsDetail] 上传头像失败:', error);
      Alert.alert('错误', '头像上传失败，请重试');
    } finally {
      setLoading(false);
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
              await supabase.auth.signOut();
              router.replace('/login');
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

              // 清除本地缓存并跳转
              await supabase.auth.signOut();
              router.replace('/login');
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

          {/* 头像 */}
          <TouchableOpacity
            style={s.avatarRow}
            onPress={handleAvatarChange}
            activeOpacity={0.7}
            disabled={loading}
          >
            <View style={s.avatarWrapper}>
              {loading ? (
                <View style={s.avatarPlaceholder}>
                  <ActivityIndicator size="small" color="#FFFFFF" />
                </View>
              ) : avatarUrl ? (
                <Image source={{ uri: avatarUrl }} style={s.avatar} />
              ) : (
                <View style={s.avatarPlaceholder}>
                  <Feather name="user" size={40} color="#FFFFFF" />
                </View>
              )}
            </View>
            <View style={s.avatarInfo}>
              <Text style={s.avatarLabel}>头像</Text>
              <Text style={s.avatarHint}>点击更换</Text>
            </View>
            <Feather name="chevron-right" size={20} color="#666" />
          </TouchableOpacity>

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
            <Text style={s.rowValue}>MyAIEnglishApp v1.0.0</Text>
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
    backgroundColor: '#121212',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#121212',
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
    backgroundColor: '#1E1E1E',
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
    backgroundColor: '#2A2A2A',
  },
  avatar: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  avatarPlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2A2A2A',
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
    backgroundColor: '#2A2A2A',
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
    backgroundColor: '#2A2A2A',
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
    backgroundColor: '#FF6B6B',
  },
  logoutText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
