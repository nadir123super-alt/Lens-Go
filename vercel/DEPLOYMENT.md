# Vercel TTS 服务部署指南

## 前置准备

1. 注册 Vercel 账号：https://vercel.com
2. 安装 Node.js 18+

## 部署步骤

### 第一步：安装 Vercel CLI

```bash
npm install -g vercel
```

### 第二步：登录 Vercel

```bash
vercel login
```

### 第三步：部署服务

进入 vercel 目录：

```bash
cd vercel
```

首次部署（开发环境）：

```bash
vercel
```

按照提示操作：
- 选择 "Set up and deploy"
- 选择你的 scope（通常是你的个人账号）
- Link to existing project? 选择 N
- Project name: 输入你的项目名（如 my-english-app-tts）
- 其他按默认即可

### 第四步：部署到生产环境

```bash
vercel --prod
```

部署成功后，你会得到一个类似这样的 URL：
`https://my-english-app-tts.vercel.app`

## 测试 API

部署完成后，可以使用 curl 测试：

```bash
curl -X POST https://your-project.vercel.app/api/tts \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello, world!", "voice": "en-US-EmmaMultilingualNeural"}' \
  --output test.mp3
```

## 配置前端

修改你的 Expo 应用，在 `services/edgeTtsService.ts` 中更新 API URL：

```typescript
const API_URL = 'https://your-project.vercel.app/api/tts';
```

## 可用音色

### 中文
- `zh-CN-XiaoxiaoNeural`（晓晓，推荐）
- `zh-CN-YunxiNeural`（云希）
- `zh-CN-YunjianNeural`（云健）

### 英文
- `en-US-EmmaMultilingualNeural`（Emma，推荐）
- `en-US-AriaNeural`（Aria）
- `en-US-GuyNeural`（Guy）

## 常见问题

### 部署失败
- 确保 Node.js 版本 >= 18
- 检查网络连接

### API 无法访问
- 确认部署成功
- 检查 API URL 是否正确

### 音色质量问题
- 尝试不同的音色
- 调整 rate 和 pitch 参数
