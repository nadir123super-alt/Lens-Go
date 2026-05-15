# Supabase Auth 生产环境配置指南

## 概述

本文档指导您�?Supabase Dashboard 中完�?Auth 配置，使邮件认证系统完全跑在您的自定义域名和 Resend 链条上�?

---

## 1. 确认 Resend 配置

### 1.1 登录 Resend 控制�?
- 访问 https://resend.com
- 确认已验证您的自定义域名 `scraplab.cc.cd`
- 确认已创�?API Key 并配置到 Supabase

### 1.2 确认 Supabase SMTP 设置
�?Supabase Dashboard 中：
1. 进入 **Authentication �?Settings**
2. 找到 **SMTP Settings** 部分
3. 确认已启�?**Custom SMTP**
4. 确认发件人邮箱设置为：`auth@scraplab.cc.cd`
5. 确认 SMTP 配置指向 Resend �?SMTP 服务器：
   - Host: `smtp.resend.com`
   - Port: `465`
   - Username: Resend API Key
   - Password: Resend API Key

---

## 2. 配置站点 URL 和重定向 URL

### 2.1 站点 URL
�?**Authentication �?Settings �?Site URL** 中设置：
```
lensgo://
```

> **说明**：Expo 应用使用自定�?URL Scheme（`lensgo`）进行深度链接。当用户点击邮件中的 Magic Link 时，系统会通过�?Scheme 打开应用�?

### 2.2 重定�?URL
�?**Authentication �?Settings �?Redirect URLs** 中添加：
```
lensgo://auth/callback
```

> **说明**：这�?Supabase Auth 完成 OTP 验证后的回调地址。Expo Router 会自动处理此深度链接�?

### 2.3 额外重定�?URL（可选）
如果将来�?Web 版本，可以添加：
```
https://your-production-domain.com/auth/callback
```

---

## 3. 确认邮件模板

�?**Authentication �?Email Templates** 中：

### 3.1 Magic Link 模板
- 确认模板中的 `{{ .SiteURL }}` 会被正确替换�?`lensgo://`
- 确认模板中的 `{{ .ConfirmationURL }}` 包含正确的重定向参数

### 3.2 OTP 模板
- 确认 OTP 邮件模板中包含验证码占位�?`{{ .Token }}`
- 确认发件人显示为自定义域名邮�?

---

## 4. 验证配置

### 4.1 使用测试按钮验证
在登录页面底部有一�?**"测试邮件发�?** 按钮�?
1. 输入您的邮箱地址
2. 点击 **"测试邮件发�?**
3. 检查邮箱（包括垃圾邮件箱）是否收到验证码邮�?
4. 如果收到，说�?Resend �?Supabase �?邮箱 链路完全正常

### 4.2 检�?Resend 发送日�?
- 登录 Resend 控制�?�?**Logs**
- 查看邮件发送状态（delivered / bounced / complained�?

### 4.3 常见问题排查

| 问题 | 可能原因 | 解决方案 |
|------|---------|---------|
| 邮件未收�?| SMTP 配置错误 | 检�?Supabase SMTP Settings 中的 Host/Port/Username/Password |
| 邮件进入垃圾�?| 域名未通过 Resend 验证 | �?Resend 中完成域�?DKIM/SPF 配置 |
| 点击链接后未打开 App | Scheme 未注�?| 确认 `app.json` �?`scheme: "lensgo"` 已配�?|
| 验证码无�?| 重定�?URL 不匹�?| 确认 Supabase Redirect URLs 中包�?`lensgo://` |

---

## 5. 生产环境切换

当您准备好切换到生产环境时：

### 5.1 更新 `.env` 文件
```env
# 生产环境使用实际域名
EXPO_PUBLIC_SITE_URL=https://your-production-domain.com
```

### 5.2 更新 Supabase Dashboard
- **Site URL**: `https://your-production-domain.com`
- **Redirect URLs**: 添加 `https://your-production-domain.com/auth/callback`

### 5.3 更新 Resend 域名配置
- 如果使用不同的生产域名，需要在 Resend 中验证新域名

---

## 6. 代码架构说明

### 6.1 登录流程
```
用户输入邮箱 �?signInWithOtp({ email, options: { emailRedirectTo: siteUrl } })
  �?Supabase 通过 Resend SMTP 发送邮�?
  �?用户收到验证�?�?输入验证�?�?verifyOtp({ email, token, type: 'email' })
  �?onAuthStateChange 触发 �?createProfileIfNeeded �?跳转到主�?
```

### 6.2 环境变量
| 变量 | �?| 说明 |
|------|-----|------|
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase 项目 URL | 已配�?|
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase 匿名密钥 | 已配�?|
| `EXPO_PUBLIC_SITE_URL` | `lensgo://` | 用于邮件中的 Magic Link 跳转 |

### 6.3 关键代码位置
- [`app/login.tsx`](../app/login.tsx) �?登录页面，包�?`signInWithOtp` 调用和测试按�?
- [`services/supabaseClient.ts`](../services/supabaseClient.ts) �?Supabase 客户端初始化
- [`.env`](../.env) �?环境变量配置

