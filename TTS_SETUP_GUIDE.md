# TTS 服务部署完整指南

## 概述

我们已经将 TTS 服务迁移到 **Vercel Serverless Functions**，这是一个完美兼容 Expo Go 的方案！

## 项目结构

```
MyAIEnglishApp/
├── services/edgeTtsService.ts  # 前端 TTS 服务（已更新）
└── vercel/                     # Vercel 部署项目
    ├── package.json
    ├── vercel.json
    ├── DEPLOYMENT.md
    └── api/
        └── tts.ts              # TTS API 核心代码
```

## 部署步骤

### 第一步：准备 Vercel 账号

1. 访问 https://vercel.com 并注册账号（免费）
2. 安装 Vercel CLI：
```bash
npm install -g vercel
```

### 第二步：部署 TTS 服务

进入 `vercel` 目录：
```bash
cd vercel
```

安装依赖：
```bash
npm install
```

登录 Vercel：
```bash
vercel login
```

部署（开发环境）：
```bash
vercel
```

按照提示操作：
- Set up and deploy? → Yes
- Which scope? → 选择你的账号
- Link to existing project? → No
- Project name → my-english-app-tts（或其他名字）
- In which directory is your code located? → ./
- Want to modify these settings? → No

部署成功后，你会得到一个类似这样的 URL：
`https://my-english-app-tts-abc123.vercel.app`

**部署到生产环境**：
```bash
vercel --prod
```

### 第三步：配置前端

1. 打开 `services/edgeTtsService.ts`
2. 找到第 20 行：
```typescript
const TTS_API_URL = 'https://your-project.vercel.app/api/tts'; // 请修改这里！
```
3. 替换为你的实际 Vercel URL，例如：
```typescript
const TTS_API_URL = 'https://my-english-app-tts-abc123.vercel.app/api/tts';
```

### 第四步：测试

1. 运行你的 Expo 应用
2. 尝试播放一段文本
3. 查看控制台日志，确认没有错误

## 测试 API（可选）

可以使用 curl 测试你的 TTS API：

```bash
curl -X POST https://your-project.vercel.app/api/tts \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello, world!", "voice": "en-US-EmmaMultilingualNeural"}' \
  --output test.mp3
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

### 问题 1：部署失败
- 确保 Node.js 版本 >= 18
- 检查网络连接
- 查看 Vercel 控制台的错误日志

### 问题 2：API 无法访问
- 确认部署成功
- 检查 API URL 是否正确
- 在浏览器中访问 URL 看看是否有响应

### 问题 3：Expo 应用无法播放
- 检查手机网络连接
- 查看控制台错误日志
- 确认 API URL 配置正确

### 问题 4：音色质量问题
- 尝试不同的音色
- 调整 rate 和 pitch 参数
- 在代码中修改 `VOICES` 常量

## Vercel 免费额度

Vercel 免费版提供：
- 每月 100 GB 带宽
- 无限次 Serverless Function 调用
- 自动 HTTPS
- 全球 CDN

对于个人学习项目完全够用！

## 下一步（可选）

如果需要更好的性能和功能，可以考虑：

1. **添加缓存** - 缓存常用文本的音频
2. **添加限流** - 防止 API 滥用
3. **使用自定义域名** - 配置你自己的域名
4. **添加分析** - 监控 API 使用情况

## 支持

如果遇到问题：
1. 查看 Vercel 控制台的部署日志
2. 查看 Expo 应用的控制台日志
3. 检查网络连接

祝部署顺利！🎉
