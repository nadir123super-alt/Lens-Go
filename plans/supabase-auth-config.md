# Supabase Auth 生产环境配置指南

## 概述

本文档指导您在 Supabase Dashboard 中完成 Auth 配置，使邮件认证系统完全跑在您的自定义域名和 Resend 链条上。

---

## 1. 确认 Resend 配置

### 1.1 登录 Resend 控制台
- 访问 https://resend.com
- 确认已验证您的自定义域名 `scraplab.cc.cd`
- 确认已创建 API Key 并配置到 Supabase

### 1.2 确认 Supabase SMTP 设置
在 Supabase Dashboard 中：
1. 进入 **Authentication → Settings**
2. 找到 **SMTP Settings** 部分
3. 确认已启用 **Custom SMTP**
4. 确认发件人邮箱设置为：`auth@scraplab.cc.cd`
5. 确认 SMTP 配置指向 Resend 的 SMTP 服务器：
   - Host: `smtp.resend.com`
   - Port: `465`
   - Username: Resend API Key
   - Password: Resend API Key

---

## 2. 配置站点 URL 和重定向 URL

### 2.1 站点 URL
在 **Authentication → Settings → Site URL** 中设置：
```
myaienglishapp://
```

> **说明**：Expo 应用使用自定义 URL Scheme（`myaienglishapp`）进行深度链接。当用户点击邮件中的 Magic Link 时，系统会通过此 Scheme 打开应用。

### 2.2 重定向 URL
在 **Authentication → Settings → Redirect URLs** 中添加：
```
myaienglishapp://auth/callback
```

> **说明**：这是 Supabase Auth 完成 OTP 验证后的回调地址。Expo Router 会自动处理此深度链接。

### 2.3 额外重定向 URL（可选）
如果将来有 Web 版本，可以添加：
```
https://your-production-domain.com/auth/callback
```

---

## 3. 确认邮件模板

在 **Authentication → Email Templates** 中：

### 3.1 Magic Link 模板
- 确认模板中的 `{{ .SiteURL }}` 会被正确替换为 `myaienglishapp://`
- 确认模板中的 `{{ .ConfirmationURL }}` 包含正确的重定向参数

### 3.2 OTP 模板
- 确认 OTP 邮件模板中包含验证码占位符 `{{ .Token }}`
- 确认发件人显示为自定义域名邮箱

---

## 4. 验证配置

### 4.1 使用测试按钮验证
在登录页面底部有一个 **"测试邮件发送"** 按钮：
1. 输入您的邮箱地址
2. 点击 **"测试邮件发送"**
3. 检查邮箱（包括垃圾邮件箱）是否收到验证码邮件
4. 如果收到，说明 Resend → Supabase → 邮箱 链路完全正常

### 4.2 检查 Resend 发送日志
- 登录 Resend 控制台 → **Logs**
- 查看邮件发送状态（delivered / bounced / complained）

### 4.3 常见问题排查

| 问题 | 可能原因 | 解决方案 |
|------|---------|---------|
| 邮件未收到 | SMTP 配置错误 | 检查 Supabase SMTP Settings 中的 Host/Port/Username/Password |
| 邮件进入垃圾箱 | 域名未通过 Resend 验证 | 在 Resend 中完成域名 DKIM/SPF 配置 |
| 点击链接后未打开 App | Scheme 未注册 | 确认 `app.json` 中 `scheme: "myaienglishapp"` 已配置 |
| 验证码无效 | 重定向 URL 不匹配 | 确认 Supabase Redirect URLs 中包含 `myaienglishapp://` |

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
用户输入邮箱 → signInWithOtp({ email, options: { emailRedirectTo: siteUrl } })
  → Supabase 通过 Resend SMTP 发送邮件
  → 用户收到验证码 → 输入验证码 → verifyOtp({ email, token, type: 'email' })
  → onAuthStateChange 触发 → createProfileIfNeeded → 跳转到主页
```

### 6.2 环境变量
| 变量 | 值 | 说明 |
|------|-----|------|
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase 项目 URL | 已配置 |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase 匿名密钥 | 已配置 |
| `EXPO_PUBLIC_SITE_URL` | `myaienglishapp://` | 用于邮件中的 Magic Link 跳转 |

### 6.3 关键代码位置
- [`app/login.tsx`](../app/login.tsx) — 登录页面，包含 `signInWithOtp` 调用和测试按钮
- [`services/supabaseClient.ts`](../services/supabaseClient.ts) — Supabase 客户端初始化
- [`.env`](../.env) — 环境变量配置
