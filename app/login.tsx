/**
 * LoginScreen — 登录/注册页面
 * 使用 Supabase OTP 邮箱认证体系
 */
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert, AppState, AppStateStatus, KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { supabase } from '../services/supabaseClient';

type FormMode = 'login' | 'signup';

const COUNTDOWN_KEY = 'login_countdown_end_time';
const COUNTDOWN_DURATION = 60; // 60秒倒计时

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const timerRef = useRef<number | null>(null);

  const [mode, setMode] = useState<FormMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [isSendingCode, setIsSendingCode] = useState(false); // 发送验证码 loading
  const [isSubmitting, setIsSubmitting] = useState(false); // 注册/登录 loading
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [codeError, setCodeError] = useState('');
  const [isTestingEmail, setIsTestingEmail] = useState(false); // 测试邮件发送 loading

  // 检查是否已登录
  useEffect(() => {
    checkAuthState();
    
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session) {
        await createProfileIfNeeded(session.user.id, session.user.email || '');
        router.replace('/(tabs)');
      }
    });

    return () => subscription?.unsubscribe();
  }, []);

  // 恢复倒计时状态
  useEffect(() => {
    restoreCountdown();
  }, []);

  // 倒计时定时器
  useEffect(() => {
    if (countdown > 0) {
      timerRef.current = window.setInterval(() => {
        updateCountdown();
      }, 1000);
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [countdown]);

  // AppState 监听
  useEffect(() => {
    const handleAppStateChange = async (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        await restoreCountdown();
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      subscription.remove();
    };
  }, []);

  // 从缓存恢复倒计时
  const restoreCountdown = async () => {
    try {
      const endTimeStr = await AsyncStorage.getItem(COUNTDOWN_KEY);
      if (endTimeStr) {
        const endTime = parseInt(endTimeStr, 10);
        const now = Date.now();
        
        if (now < endTime) {
          const remaining = Math.ceil((endTime - now) / 1000);
          setCountdown(Math.max(0, remaining));
        } else {
          setCountdown(0);
          await AsyncStorage.removeItem(COUNTDOWN_KEY);
        }
      }
    } catch (error) {
      console.warn('[Login] 恢复倒计时失败:', error);
    }
  };

  // 更新倒计时
  const updateCountdown = async () => {
    try {
      const endTimeStr = await AsyncStorage.getItem(COUNTDOWN_KEY);
      if (endTimeStr) {
        const endTime = parseInt(endTimeStr, 10);
        const now = Date.now();
        
        if (now < endTime) {
          const remaining = Math.ceil((endTime - now) / 1000);
          setCountdown(Math.max(0, remaining));
        } else {
          setCountdown(0);
          await AsyncStorage.removeItem(COUNTDOWN_KEY);
        }
      } else {
        setCountdown(0);
      }
    } catch (error) {
      console.warn('[Login] 更新倒计时失败:', error);
      setCountdown(0);
    }
  };

  // 检查当前认证状态
  const checkAuthState = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      router.replace('/(tabs)');
    }
  };

  // 生成8位随机昵称（首字母为英文字母，后续7位为字母数字组合）
  const generateRandomNickname = (): string => {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    const lettersAndDigits = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    
    // 首字母必须是英文字母
    const firstChar = letters[Math.floor(Math.random() * letters.length)];
    
    // 后续7位是字母数字组合
    let rest = '';
    for (let i = 0; i < 7; i++) {
      rest += lettersAndDigits[Math.floor(Math.random() * lettersAndDigits.length)];
    }
    
    return firstChar + rest;
  };

  // 如果是新用户，创建默认资料
  // 注意：Supabase 触发器 on_auth_user_created 已自动创建 profile（含默认昵称）
  // 此处使用 upsert 确保与触发器不冲突
  const createProfileIfNeeded = async (userId: string, userEmail: string) => {
    try {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('id, nickname')
        .eq('id', userId)
        .single();

      if (error || !profile) {
        // 新用户：生成8位随机昵称
        const randomNickname = generateRandomNickname();
        
        // 使用 upsert 避免与触发器冲突（触发器可能已插入）
        const { error: upsertError } = await supabase
          .from('profiles')
          .upsert({
            id: userId,
            nickname: randomNickname,
            email: userEmail,
          }, { onConflict: 'id' });
        
        if (upsertError) {
          console.warn('[Login] upsert 用户资料失败:', upsertError);
        } else {
          console.log('[Login] 创建默认用户资料:', randomNickname);
        }
      } else if (!profile.nickname) {
        // 用户存在但没有昵称：补充随机昵称
        const randomNickname = generateRandomNickname();
        
        await supabase
          .from('profiles')
          .update({ nickname: randomNickname })
          .eq('id', userId);
        
        console.log('[Login] 补充用户昵称:', randomNickname);
      }
    } catch (error) {
      console.warn('[Login] 创建用户资料失败:', error);
    }
  };

  // 验证邮箱格式
  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  // 验证密码长度
  const validatePassword = (password: string): boolean => {
    return password.length >= 6;
  };

  // 验证验证码
  const validateCode = (code: string): boolean => {
    return code.length === 6 && /^\d+$/.test(code);
  };

  // 登录模式表单验证
  const validateLoginForm = (): boolean => {
    let isValid = true;
    
    if (!email.trim()) {
      setEmailError('请输入邮箱');
      isValid = false;
    } else if (!validateEmail(email)) {
      setEmailError('请输入正确的邮箱格式');
      isValid = false;
    } else {
      setEmailError('');
    }

    if (!password) {
      setPasswordError('请输入密码');
      isValid = false;
    } else if (!validatePassword(password)) {
      setPasswordError('密码长度不能少于6位');
      isValid = false;
    } else {
      setPasswordError('');
    }

    return isValid;
  };

  // 注册模式表单验证
  const validateSignupForm = (): boolean => {
    let isValid = true;
    
    if (!email.trim()) {
      setEmailError('请输入邮箱');
      isValid = false;
    } else if (!validateEmail(email)) {
      setEmailError('请输入正确的邮箱格式');
      isValid = false;
    } else {
      setEmailError('');
    }

    if (!code) {
      setCodeError('请输入验证码');
      isValid = false;
    } else if (!validateCode(code)) {
      setCodeError('请输入6位数字验证码');
      isValid = false;
    } else {
      setCodeError('');
    }

    if (!password) {
      setPasswordError('请设置密码');
      isValid = false;
    } else if (!validatePassword(password)) {
      setPasswordError('密码长度不能少于6位');
      isValid = false;
    } else {
      setPasswordError('');
    }

    return isValid;
  };

  // 获取验证码
  const handleGetCode = async () => {
    if (!email.trim()) {
      setEmailError('请先输入邮箱');
      return;
    }

    if (!validateEmail(email)) {
      setEmailError('请输入正确的邮箱格式');
      return;
    }

    // 如果是注册模式，先检查邮箱是否已存在
    if (mode === 'signup') {
      setIsSendingCode(true);
      try {
        const { data: existingUser, error: checkError } = await supabase
          .from('profiles')
          .select('email')
          .eq('email', email.trim())
          .maybeSingle();

        if (checkError) {
          console.error('[Login] 查询邮箱失败:', checkError);
          Alert.alert('错误', '查询失败，请重试');
          setIsSendingCode(false);
          return;
        }

        if (existingUser) {
          // 邮箱已存在，提示用户登录
          Alert.alert(
            '已有帐号',
            '已有帐号，请登录',
            [
              {
                text: '切换到登录',
                onPress: () => {
                  setMode('login');
                  setCode('');
                  setPassword('');
                },
                style: 'default',
              },
              {
                text: '知道了',
                style: 'cancel',
              },
            ],
            { cancelable: false }
          );
          setIsSendingCode(false);
          return;
        }
      } catch (error) {
        console.error('[Login] 邮箱查重异常:', error);
        Alert.alert('错误', '查询失败，请重试');
        setIsSendingCode(false);
        return;
      }
    }

    setIsSendingCode(true);
    try {
      // 从环境变量读取站点 URL，用于邮件中的 Magic Link 跳转
      // 本地开发使用 Expo scheme，生产环境使用实际域名
      const siteUrl = process.env.EXPO_PUBLIC_SITE_URL || 'myaienglishapp://';

      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          // 设置邮件中的跳转链接，兼容本地和生产环境
          emailRedirectTo: siteUrl,
        },
      });

      if (error) {
        console.warn('[Login] 获取验证码失败:', error.message);
        Alert.alert('获取验证码失败', '验证码发送失败，请检查邮箱是否正确或稍后重试');
      } else {
        // 记录倒计时结束时间
        const endTime = Date.now() + COUNTDOWN_DURATION * 1000;
        await AsyncStorage.setItem(COUNTDOWN_KEY, endTime.toString());
        setCountdown(COUNTDOWN_DURATION);
        Alert.alert('提示', '验证码已发送到您的邮箱');
      }
    } catch (error) {
      console.warn('[Login] 获取验证码异常:', error);
      Alert.alert('错误', '操作失败，请重试');
    } finally {
      setIsSendingCode(false);
    }
  };

  // 测试邮件发送 — 直接调用 signInWithOtp，验证 Resend 是否能成功投递
  const handleTestEmail = async () => {
    if (!email.trim()) {
      Alert.alert('提示', '请先输入邮箱地址');
      return;
    }
    if (!validateEmail(email.trim())) {
      Alert.alert('提示', '请输入正确的邮箱格式');
      return;
    }
    setIsTestingEmail(true);
    try {
      const siteUrl = process.env.EXPO_PUBLIC_SITE_URL || 'myaienglishapp://';
      console.log('[TestEmail] 发送测试邮件到:', email.trim(), 'siteUrl:', siteUrl);

      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: siteUrl,
        },
      });

      if (error) {
        console.error('[TestEmail] 发送失败:', error);
        Alert.alert('❌ 发送失败', `错误信息: ${error.message}\n\n请检查 Supabase Dashboard → Authentication → Settings 中的 SMTP 配置。`);
      } else {
        Alert.alert(
          '✅ 测试邮件已发送',
          `收件人: ${email.trim()}\n\n请检查您的邮箱（包括垃圾邮件箱）。如果未收到：\n1. 确认 Supabase Dashboard → Authentication → Settings 中已配置 SMTP/Resend\n2. 确认自定义域名已通过 Resend 验证\n3. 检查 Resend 控制台的发送日志`,
        );
      }
    } catch (err: any) {
      console.error('[TestEmail] 异常:', err);
      Alert.alert('❌ 发送异常', err?.message || '未知错误');
    } finally {
      setIsTestingEmail(false);
    }
  };

  // 登录（密码方式）
  const handleLogin = async () => {
    if (!validateLoginForm()) return;

    setIsSubmitting(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        // Invalid login credentials = 用户不存在或密码错误
        // 此时统一提示"账号未注册"，引导用户去注册
        if (error.message === 'Invalid login credentials') {
          Alert.alert(
            '账号未注册',
            '该邮箱尚未注册，是否前往注册？',
            [
              {
                text: '取消',
                style: 'cancel',
              },
              {
                text: '立即注册',
                onPress: () => {
                  setMode('signup');
                  setPassword('');
                  setPasswordError('');
                },
                style: 'default',
              },
            ],
            { cancelable: false }
          );
        } else {
          console.warn('[Login] 登录失败:', error.message);
          Alert.alert('登录失败', error.message);
        }
      }
    } catch (error) {
      console.warn('[Login] 登录异常:', error);
      Alert.alert('错误', '登录失败，请重试');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 注册并登录（验证码+密码方式）
  const handleSignup = async () => {
    if (!validateSignupForm()) return;

    setIsSubmitting(true);
    try {
      // 第一步：验证验证码
      const { error: otpError } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: code,
        type: 'email',
      });

      if (otpError) {
        console.error('[Login] 验证码验证失败:', otpError);
        setCodeError('验证码错误或已过期');
        return;
      }

      // 第二步：设置密码（如果用户设置了密码）
      if (password) {
        const { error: passwordError } = await supabase.auth.updateUser({
          password,
        });

        if (passwordError) {
          console.error('[Login] 设置密码失败:', passwordError);
          Alert.alert('错误', '设置密码失败: ' + passwordError.message);
          return;
        }
      }

      // 成功后 onAuthStateChange 会自动跳转
    } catch (error) {
      console.error('[Login] 注册异常:', error);
      Alert.alert('错误', '注册失败，请重试');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 忘记密码
  const handleForgotPassword = async () => {
    if (!email.trim()) {
      Alert.alert('提示', '请先输入邮箱');
      return;
    }

    setIsSubmitting(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
      
      if (error) {
        console.error('[Login] 重置密码失败:', error);
        Alert.alert('失败', error.message);
      } else {
        Alert.alert('成功', '密码重置链接已发送到您的邮箱');
      }
    } catch (error) {
      console.error('[Login] 重置密码异常:', error);
      Alert.alert('错误', '操作失败，请重试');
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
        <Text style={s.appName}>MyAIEnglish</Text>
        <Text style={s.slogan}>让 AI 帮你学好英语</Text>
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
                if (emailError) setEmailError('');
              }}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>
          {emailError && <Text style={s.errorText}>{emailError}</Text>}
        </View>

        {/* 登录模式：密码输入 */}
        {mode === 'login' && (
          <View style={s.inputContainer}>
            <Text style={s.label}>密码</Text>
            <View style={s.inputWrapper}>
              <Feather name="lock" size={18} color="#666" />
              <TextInput
                style={s.input}
                placeholder="请输入密码"
                placeholderTextColor="#666666"
                value={password}
                onChangeText={(text) => {
                  setPassword(text);
                  if (passwordError) setPasswordError('');
                }}
                secureTextEntry={!showPassword}
              />
              <TouchableOpacity
                onPress={() => setShowPassword(!showPassword)}
                style={s.toggleBtn}
              >
                <Feather name={showPassword ? 'eye-off' : 'eye'} size={18} color="#666" />
              </TouchableOpacity>
            </View>
            {passwordError && <Text style={s.errorText}>{passwordError}</Text>}
          </View>
        )}

        {/* 注册模式：验证码输入 + 获取按钮 */}
        {mode === 'signup' && (
          <View style={s.inputContainer}>
            <Text style={s.label}>验证码</Text>
            <View style={s.codeRow}>
              <View style={s.codeInputWrapper}>
                <Feather name="key" size={18} color="#666" />
                <TextInput
                  style={s.input}
                  placeholder="请输入验证码"
                  placeholderTextColor="#666666"
                  value={code}
                  onChangeText={(text) => {
                    setCode(text);
                    if (codeError) setCodeError('');
                  }}
                  keyboardType="numeric"
                  maxLength={6}
                />
              </View>
              <TouchableOpacity
                onPress={handleGetCode}
                style={[s.codeBtn, (countdown > 0 || isSendingCode) && s.codeBtnDisabled]}
                disabled={countdown > 0 || isSendingCode}
              >
                {isSendingCode ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : countdown > 0 ? (
                  <Text style={s.codeBtnText}>重新发送({countdown}s)</Text>
                ) : (
                  <Text style={s.codeBtnText}>获取验证码</Text>
                )}
              </TouchableOpacity>
            </View>
            {codeError && <Text style={s.errorText}>{codeError}</Text>}
          </View>
        )}

        {/* 注册模式：设置密码 */}
        {mode === 'signup' && (
          <View style={s.inputContainer}>
            <Text style={s.label}>设置密码</Text>
            <View style={s.inputWrapper}>
              <Feather name="lock" size={18} color="#666" />
              <TextInput
                style={s.input}
                placeholder="请设置密码（至少6位）"
                placeholderTextColor="#666666"
                value={password}
                onChangeText={(text) => {
                  setPassword(text);
                  if (passwordError) setPasswordError('');
                }}
                secureTextEntry={!showPassword}
              />
              <TouchableOpacity
                onPress={() => setShowPassword(!showPassword)}
                style={s.toggleBtn}
              >
                <Feather name={showPassword ? 'eye-off' : 'eye'} size={18} color="#666" />
              </TouchableOpacity>
            </View>
            {passwordError && <Text style={s.errorText}>{passwordError}</Text>}
          </View>
        )}

        {/* 忘记密码（仅登录模式显示） */}
        {mode === 'login' && (
          <TouchableOpacity
            onPress={handleForgotPassword}
            style={s.forgotBtn}
          >
            <Text style={s.forgotText}>忘记密码？</Text>
          </TouchableOpacity>
        )}

        {/* 主按钮 */}
        <View style={s.mainBtnWrapper}>
          <TouchableOpacity
            onPress={mode === 'login' ? handleLogin : handleSignup}
            style={s.mainBtn}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={s.mainBtnText}>
                {mode === 'login' ? '登录' : '注册并登录'}
              </Text>
            )}
          </TouchableOpacity>
        </View>

        {/* 切换链接 */}
        <View style={s.switchRow}>
          <Text style={s.switchText}>
            {mode === 'login' ? '还没有账号？' : '已有账号？'}
          </Text>
          <TouchableOpacity onPress={() => {
            setMode(mode === 'login' ? 'signup' : 'login');
            setCode('');
            setCodeError('');
          }}>
            <Text style={s.switchLink}>
              {mode === 'login' ? '立即注册' : '密码登录'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* 测试邮件发送按钮 — 用于验证 Supabase Auth + Resend 配置 */}
        <View style={s.testEmailSection}>
          <TouchableOpacity
            onPress={handleTestEmail}
            style={s.testEmailBtn}
            disabled={isTestingEmail}
          >
            {isTestingEmail ? (
              <ActivityIndicator size="small" color="#FF6B6B" />
            ) : (
              <>
                <Feather name="mail" size={14} color="#FF6B6B" />
                <Text style={s.testEmailBtnText}>测试邮件发送</Text>
              </>
            )}
          </TouchableOpacity>
          <Text style={s.testEmailHint}>
            输入邮箱后点击此按钮，验证 Resend 是否能成功投递
          </Text>
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
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  codeInputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E1E1E',
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 50,
  },
  codeBtn: {
    backgroundColor: '#FF6B6B',
    borderRadius: 12,
    paddingHorizontal: 18,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    width: 120,
  },
  codeBtnDisabled: {
    backgroundColor: '#444',
  },
  codeBtnText: {
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  errorText: {
    fontSize: 12,
    color: '#FF6B6B',
    marginTop: 4,
  },
  forgotBtn: {
    alignItems: 'flex-end',
    marginBottom: 16,
  },
  forgotText: {
    fontSize: 13,
    color: '#999',
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
  testEmailSection: {
    alignItems: 'center',
    marginTop: 24,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#333',
  },
  testEmailBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FF6B6B33',
    backgroundColor: '#FF6B6B11',
  },
  testEmailBtnText: {
    fontSize: 12,
    color: '#FF6B6B',
    fontWeight: '500',
  },
  testEmailHint: {
    fontSize: 11,
    color: '#666',
    marginTop: 6,
    textAlign: 'center',
    lineHeight: 16,
  },
});
