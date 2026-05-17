# Supabase Edge Functions TTS 部署指南

## 概述

本指南将帮助你把 TTS 服务部署到 Supabase Edge Functions，让你可以通过 HTTP 请求调用 Edge TTS 语音合成功能。

## 项目结构

```
MyAIEnglishApp/
├── services/
│   └── edgeTtsService.ts      # 前端 TTS 服务（已更新）
└── supabase/
    └── functions/
        └── tts/
            └── index.ts        # TTS Edge Function 核心代码
```

## 部署步骤

### 第一步：安装 Supabase CLI

打开 PowerShell，运行：

```powershell
npm install -g supabase
```

或者使用 winget：

```powershell
winget install Supabase.CLI
```

### 第二步：登录 Supabase

```powershell
supabase login
```

### 第三步：进入 supabase 目录并部署

```powershell
cd supabase
supabase functions deploy tts
```

### 第四步：获取你的 Project Reference

1. 打开 https://supabase.com/dashboard
2. 选择你的项目
3. 在项目设置中找到 **Project Reference**（类似 `abcdefghijklmnopqrst`）

### 第五步：更新前端 API URL

1. 打开 `services/edgeTtsService.ts`
2. 找到第 22 行：
```typescript
const TTS_API_URL = 'https://your-project-ref.supabase.co/functions/v1/tts';
```
3. 替换 `your-project-ref` 为你的实际 Project Reference：
```typescript
const TTS_API_URL = 'https://abcdefghijklmnopqrst.supabase.co/functions/v1/tts';
```

### 第六步：测试

1. 重启 Expo 应用
2. 尝试播放一段文本
3. 查看控制台日志，确认没有错误

## API 使用方法

### 请求

```http
POST https://your-project-ref.supabase.co/functions/v1/tts
Content-Type: application/json

{
  "text": "Hello, world!",
  "voice": "en-US-EmmaMultilingualNeural",
  "rate": "-8%",
  "pitch": "+2Hz"
}
```

### 参数说明

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| text | string | 必填 | 要合成语音的文本 |
| voice | string | en-US-EmmaMultilingualNeural | 音色名称 |
| rate | string | -8% | 语速（-100% 到 +100%）|
| pitch | string | +2Hz | 音调（-50Hz 到 +50Hz）|

### 响应

成功时返回 `audio/mpeg` 格式的音频数据。

### 可用音色

#### 中文
- `zh-CN-XiaoxiaoNeural` - 晓晓（推荐）
- `zh-CN-YunxiNeural` - 云希
- `zh-CN-YunjianNeural` - 云健

#### 英文
- `en-US-EmmaMultilingualNeural` - Emma（推荐）
- `en-US-AriaNeural` - Aria
- `en-US-GuyNeural` - Guy

## 测试 API（可选）

使用 curl 测试：

```powershell
curl -X POST "https://your-project-ref.supabase.co/functions/v1/tts" `
  -H "Content-Type: application/json" `
  -d '{"text": "Hello world", "voice": "en-US-EmmaMultilingualNeural"}" `
  --output test.mp3
```

## 常见问题

### 问题 1：部署失败
- 确保已登录：`supabase login`
- 检查网络连接
- 查看错误日志

### 问题 2：API 无法访问
- 确认 Project Reference 正确
- 检查 Edge Function 是否部署成功
- 在 Supabase Dashboard 查看函数日志

### 问题 3：音频质量问题
- 尝试不同的音色
- 调整 rate 和 pitch 参数

### 问题 4：CPU 时间超时
- Edge TTS CPU 时间限制为 2 秒
- 如果文本过长，可能会超时
- 建议限制单次请求的文本长度（建议 500 字符以内）

## 免费额度

Supabase Edge Functions 免费额度：
- **500,000 次/月** - 完全够个人使用
- **2 秒 CPU 时间/次** - 对于 TTS 足够
- **256 MB 内存** - 够用

## 本地开发测试

如果想在本地测试 Edge Function：

```powershell
cd supabase
supabase functions serve tts
```

然后在另一个终端运行：

```powershell
curl -X POST "http://localhost:54321/functions/v1/tts" `
  -H "Content-Type: application/json" `
  -d '{"text": "Hello world"}'
```

## 下一步

1. 完成部署后，记得更新 `services/edgeTtsService.ts` 中的 `TTS_API_URL`
2. 重启 Expo 应用
3. 测试 TTS 功能

祝你部署顺利！🎉
