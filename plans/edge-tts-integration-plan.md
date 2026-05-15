# Edge TTS 集成方案 — 架构设计文档

## 1. 概述

将当前基于 `expo-speech`（系统原生 TTS）的语音合成方案，升级为 **Edge TTS** 网络方案，实现：
- **单一卡通音色**：`en-US-AnaNeural`（活泼女声），全应用统一
- **精准音字同步**：通过 Edge TTS 返回的时间轴数据，实现"读到哪亮到哪"
- **本地缓存**：音频 + 时间戳缓存，秒开体验
- **离线 Fallback**：网络异常时自动降级到系统原生 TTS

---

## 2. 架构总览

```
┌─────────────────────────────────────────────────────────────┐
│                    调用方 (Callers)                          │
│  camera.tsx / word-detail.tsx / practice.tsx                │
│  → playText(text, onDone, onProgress, word)                │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              SoundManager (soundManager.ts)                  │
│  统一入口，管理播放状态、即点即停、计数器                      │
│                                                              │
│  playText() 内部逻辑：                                        │
│  1. 检查本地缓存 → 有则 playFile() + 时间轴驱动高亮           │
│  2. 无缓存 → 调用 EdgeTtsService.fetch()                     │
│  3. 超时/失败 → 降级到 expo-speech（当前逻辑）               │
└──────────────────────┬──────────────────────────────────────┘
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
   ┌──────────┐ ┌──────────┐ ┌──────────┐
   │ Edge TTS │ │ 本地缓存  │ │ expo-    │
   │ 网络请求  │ │ (FileSystem)│ │ speech   │
   └──────────┘ └──────────┘ └──────────┘
```

---

## 3. 新增文件清单

### 3.1 `services/edgeTtsService.ts` — Edge TTS 核心服务

**职责**：
1. 向 Edge TTS API 发送 SSML 请求，获取音频 + 时间轴数据
2. 解析返回的 JSON，提取 `word`, `start_time`, `duration` 时间轴
3. 将音频保存到本地文件系统，时间轴保存为 JSON
4. 提供 `fetch(text): Promise<EdgeTtsResult | null>` 接口

**核心接口**：

```typescript
// 时间轴条目
interface TimestampWord {
  word: string;          // 单词原文
  start_time: number;    // 起始时间（毫秒）
  duration: number;      // 持续时间（毫秒）
  char_offset?: number;  // 在原始文本中的字符偏移
}

// Edge TTS 返回结果
interface EdgeTtsResult {
  audioUri: string;      // 本地音频文件 URI
  timestamps: TimestampWord[];  // 时间轴数据
  duration: number;      // 总时长（毫秒）
  text: string;          // 原始文本
}

// 缓存条目
interface CacheEntry {
  audioUri: string;
  timestamps: TimestampWord[];
  createdAt: string;
}
```

**SSML 模板**：
```xml
<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis"
       xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="en-US">
  <voice name="en-US-AnaNeural">
    <mstts:express-as style="cheerful">
      <prosody pitch="+10%" rate="+0%">
        {TEXT}
      </prosody>
    </mstts:express-as>
  </voice>
</speak>
```

**API 端点**：Edge TTS 的免费 API 可通过以下方式调用：
- 方案 A：直接调用 `edge-tts` 的 HTTP 服务（需自建中转）
- 方案 B：使用浏览器 Web Speech API 风格的 Edge TTS 免费接口
- **推荐方案**：使用 `https://speech.platform.bing.com/consumer/speech/synthesize/readaloud` 的 Edge 浏览器内部接口（免 Key）

**请求流程**：
```
1. 获取 Edge TTS 的授权令牌（通过 wss:// 或 HTTP 请求）
2. 构造 SSML 请求体
3. 发送 POST 请求，获取音频二进制流
4. 解析响应头中的时间轴数据（X-Microsoft-StreamId/TimeStamp 等）
5. 将音频写入本地缓存文件
6. 返回 EdgeTtsResult
```

### 3.2 `services/ttsCacheService.ts` — 缓存管理服务

**职责**：
1. 管理音频文件 + 时间戳 JSON 的本地缓存
2. 缓存键：基于文本内容的 MD5 哈希
3. 缓存目录：`FileSystem.cacheDirectory + 'tts_cache/'`
4. 提供 `get(text)` / `set(text, data)` / `clear()` 接口

**缓存结构**：
```
tts_cache/
├── {md5_hash}.mp3          # 音频文件
├── {md5_hash}.json         # 时间轴数据
└── index.json              # 缓存索引（可选）
```

**核心接口**：
```typescript
interface TtsCacheService {
  get(text: string): Promise<EdgeTtsResult | null>;
  set(text: string, result: EdgeTtsResult): Promise<void>;
  clear(): Promise<void>;
  has(text: string): Promise<boolean>;
}
```

### 3.3 `services/timestampDriver.ts` — 时间轴驱动引擎

**职责**：
1. 接收 `TimestampWord[]` 时间轴数据
2. 在音频播放时，通过高频定时器（~50ms）轮询播放位置
3. 匹配当前播放时间对应的时间轴条目
4. 回调通知前端更新高亮索引

**核心接口**：
```typescript
interface TimestampDriver {
  start(
    timestamps: TimestampWord[],
    onWordChange: (wordIndex: number, word: string) => void,
    onCharProgress?: (charIndex: number) => void
  ): void;
  stop(): void;
  getCurrentIndex(): number;
}
```

**驱动逻辑**：
```
高频定时器 (50ms)
    │
    ▼
获取 AudioModule 当前播放位置 (positionMillis)
    │
    ▼
二分查找 timestamps 中 start_time ≤ positionMillis 的最大索引
    │
    ▼
如果索引变化 → 回调 onWordChange(newIndex, word)
    │
    ▼
计算单词内字符进度 → 回调 onCharProgress(charIndex)
```

---

## 4. 修改文件清单

### 4.1 `services/soundManager.ts` — 核心修改

**修改内容**：
1. `playText()` 新增 Edge TTS 分支逻辑
2. 集成 `timestampDriver` 实现精准高亮
3. 新增 `onWordHighlight` 回调参数

**伪代码**：
```typescript
export function playText(
  text: string,
  onDone?: () => void,
  onProgress?: (progress: number) => void,
  word?: string,
  onWordHighlight?: (wordIndex: number) => void  // 新增
): void {
  // 1. 先停止当前播放
  if (current) stopAll();

  // 2. 尝试 Edge TTS（带超时）
  const edgeResult = await Promise.race([
    EdgeTtsService.fetch(text),
    timeout(2000)  // 2 秒超时
  ]);

  if (edgeResult) {
    // 3. Edge TTS 成功 → 播放缓存音频 + 时间轴驱动
    const player = await playFile(edgeResult.audioUri);
    if (player) {
      timestampDriver.start(
        edgeResult.timestamps,
        (wordIndex) => onWordHighlight?.(wordIndex),
        (charIndex) => onProgress?.(charIndex)
      );
    }
  } else {
    // 4. Fallback → 使用 expo-speech（当前逻辑）
    fallbackToExpoSpeech(text, onDone, onProgress);
  }
}
```

### 4.2 `services/ttsService.ts` — 可选修改

如果 `playTextWithCharProgress` 也需要 Edge TTS 支持（practice 场景），可在此处集成。但考虑到 practice 场景对实时性要求更高，**建议先只改 soundManager.ts**，practice 场景保留现有逻辑。

### 4.3 `app/camera.tsx` / `app/word-detail.tsx` — 传递高亮回调

在调用 `playText` 时传入 `onWordHighlight` 回调，用于更新 UI 高亮状态。

---

## 5. 数据流图

```
用户点击发音按钮
    │
    ▼
playText(text, onDone, onProgress, word, onWordHighlight)
    │
    ├── 检查缓存 (ttsCacheService.get)
    │   ├── 命中 → 直接使用缓存音频 + 时间轴
    │   └── 未命中 → 发起 Edge TTS 网络请求
    │       ├── 成功 → 保存到缓存 + 播放
    │       └── 失败/超时(2s) → Fallback 到 expo-speech
    │
    ▼
音频播放开始
    │
    ├── Edge TTS 路径：
    │   ├── playFile(audioUri) → expo-audio 播放
    │   └── timestampDriver.start(timestamps, onWordChange)
    │       └── 高频定时器 → 匹配时间轴 → 回调高亮
    │
    └── Fallback 路径：
        └── Speech.speak() + setTimeout 模拟进度（现有逻辑）
```

---

## 6. 关键决策点

### 6.1 Edge TTS API 调用方式

**方案 A：直接调用 Edge 内部接口**
- URL: `https://speech.platform.bing.com/consumer/speech/synthesize/readaloud`
- 优点：完全免费，无需任何 Key
- 缺点：需要先获取授权令牌（通过 Edge 的 WebSocket 连接）
- 复杂度：中等

**方案 B：自建 edge-tts 服务**
- 使用 Python 的 `edge-tts` 库搭建本地 HTTP 服务
- 优点：稳定可靠，社区成熟
- 缺点：需要额外部署

**推荐：方案 A** — 纯前端实现，无需后端

### 6.2 时间轴数据获取

Edge TTS 返回的音频流中，时间轴信息通常包含在：
1. **SSML 响应中的 `mstts:viseme` 或 `mstts:silence` 标记**
2. **响应头中的自定义字段**
3. **WebSocket 消息中的 JSON 元数据**

需要实际测试确认 Edge TTS 返回的具体格式。

### 6.3 缓存策略

| 策略 | 说明 |
|------|------|
| 缓存键 | MD5(文本内容) |
| 缓存位置 | `FileSystem.cacheDirectory` |
| 最大缓存 | 100 MB 或 1000 条 |
| 淘汰策略 | LRU（最近最少使用） |
| 缓存有效期 | 永久（文本不变则音频不变） |

---

## 7. 实施步骤

### Step 1: 创建 `services/edgeTtsService.ts`
- 实现 Edge TTS API 调用
- SSML 封装（`en-US-AnaNeural` + `cheerful` + `pitch+10%`）
- 音频流下载 + 时间轴解析
- 返回 `EdgeTtsResult`

### Step 2: 创建 `services/ttsCacheService.ts`
- 基于 `expo-file-system` 的本地缓存
- MD5 哈希作为缓存键
- `get/set/has/clear` 接口

### Step 3: 创建 `services/timestampDriver.ts`
- 高频定时器轮询播放位置
- 二分查找匹配时间轴
- 回调通知高亮变化

### Step 4: 修改 `services/soundManager.ts`
- `playText` 新增 Edge TTS 分支
- 集成缓存检查 + 超时 Fallback
- 新增 `onWordHighlight` 回调参数

### Step 5: 更新调用方
- `app/camera.tsx` — 传递高亮回调
- `app/word-detail.tsx` — 传递高亮回调
- 更新 UI 组件支持单词级高亮

### Step 6: 测试
- 网络正常时：Edge TTS 发音 + 精准高亮
- 网络超时：2 秒后自动降级到 expo-speech
- 缓存命中：秒开，无网络请求
- 即点即停：Edge TTS 播放中点击新单词 → 停止 + 重新播放

---

## 8. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| Edge TTS 接口变更 | 服务不可用 | 2 秒超时 Fallback 到 expo-speech |
| 音频文件过大 | 缓存占用空间 | LRU 淘汰 + 最大 100MB 限制 |
| 时间轴不精确 | 高亮偏移 | 保留 expo-speech 模拟进度作为备选 |
| 首次加载慢 | 用户体验差 | 缓存机制 + 预加载常用单词 |
| expo-audio 兼容性 | 无法播放音频 | 降级到 expo-av 的 Audio.Sound |

---

## 9. 时间轴数据格式（预期）

Edge TTS 返回的时间轴数据格式（需实际验证）：

```json
[
  {
    "word": "Hello",
    "start_time": 0,
    "duration": 300,
    "char_offset": 0
  },
  {
    "word": "world",
    "start_time": 350,
    "duration": 400,
    "char_offset": 6
  }
]
```

如果 Edge TTS 不直接返回时间轴，备选方案：
1. 使用 SSML 的 `mstts:viseme` 标记推算
2. 使用音频时长 + 文本长度估算（类似当前模拟方案）
3. 使用 Web Speech API 的 `onboundary` 事件

---

## 10. 未修改的现有逻辑

以下逻辑保持不变：
- **`utils/audioCounter.ts`** — 播放计数器（复读机/念念不忘勋章）
- **`services/achievementService.ts`** — 成就检测
- **`services/speechSettingsService.ts`** — 语速设置（Edge TTS 通过 SSML rate 参数控制）
- **`services/textCleaner.ts`** — 文本清洗
- **`services/ttsService.ts`** — 保留作为 Fallback 路径
- **`app/practice.tsx`** — 口语练习场景暂不改动（使用现有 `playTextWithCharProgress`）
