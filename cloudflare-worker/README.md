# Supabase 反向代理（Cloudflare Worker）

## 为什么需要它

中国大陆网络环境下，`*.supabase.co` 域名被 GFW 阻断：

- DNS 解析正常（返回 Cloudflare IP，如 `104.18.38.10`）
- 但 TLS 握手被重置（`curl` 报 `exit 35` / `HTTP 000`）
- 结果：App 登录/注册/数据请求全部报 **Network request failed**

本 Worker 部署在 Cloudflare 边缘节点，通过**自定义域名**（如 `api.scraplab.cc.cd`）代理所有 Supabase 请求，从而绕过对 `*.supabase.co` 的封锁。

```
App 请求  https://api.scraplab.cc.cd/auth/v1/token
  → Worker 转发到  https://cqpszvmritgldvzhlbds.supabase.co/auth/v1/token
  → 原样返回响应
```

支持全部 Supabase 接口：

| 接口 | 路径 |
|------|------|
| Auth 认证 | `/auth/v1/*` |
| REST 数据 | `/rest/v1/*` |
| Storage 存储 | `/storage/v1/*` |
| Edge Functions | `/functions/v1/*` |
| Realtime WebSocket | `/realtime/v1/*` |

---

## 前置条件

1. 一个 **Cloudflare 账号**（免费版即可）：https://dash.cloudflare.com/sign-up
2. 一个**已托管在 Cloudflare 的域名**（本项目使用 `scraplab.cc.cd`）
   - 如果域名不在 Cloudflare，需要先把域名的 NS 记录改到 Cloudflare
3. 本机安装 **Node.js 18+**

---

## 部署步骤

### 第 1 步：安装并登录 wrangler

```bash
npm install -g wrangler
wrangler login
```

`wrangler login` 会打开浏览器，授权后即可。

### 第 2 步：确认配置

打开 [`wrangler.toml`](wrangler.toml:1)，确认以下两项：

```toml
name = "supabase-proxy"                                    # Worker 名称，可自定义
[vars]
SUPABASE_HOST = "cqpszvmritgldvzhlbds.supabase.co"         # 你的 Supabase 项目域名
```

> `SUPABASE_HOST` 不要带 `https://`，只写域名。

### 第 3 步：本地测试（可选）

```bash
cd cloudflare-worker
npm install
npm run dev
```

本地会启动 `http://localhost:8787`，可用以下命令验证代理是否正常：

```bash
curl -i http://localhost:8787/auth/v1/health
```

返回 `200` 且带 `{"name":"GoTrue",...}` 即成功。

### 第 4 步：部署

```bash
cd cloudflare-worker
npm run deploy
```

部署成功后会输出一个 `*.workers.dev` 地址，例如：

```
https://supabase-proxy.你的账号.workers.dev
```

此时可先测试：

```bash
curl -i https://supabase-proxy.你的账号.workers.dev/auth/v1/health
```

### 第 5 步：绑定自定义域名（关键）

`*.workers.dev` 在国内同样可能被阻断，**必须绑定自己的域名**。

**方式 A：Cloudflare Dashboard（推荐，最简单）**

1. 打开 https://dash.cloudflare.com → **Workers & Pages**
2. 点击你的 Worker（`supabase-proxy`）
3. 进入 **Settings → Domains & Routes → Add → Custom Domain**
4. 输入 `api.scraplab.cc.cd`，确认
5. 等待 1~2 分钟，Cloudflare 会自动创建 DNS 记录并签发证书

**方式 B：wrangler.toml 声明式绑定**

取消 [`wrangler.toml`](wrangler.toml:41) 末尾的注释：

```toml
[[routes]]
pattern = "api.scraplab.cc.cd"
custom_domain = true
```

然后重新 `npm run deploy`。

### 第 6 步：验证自定义域名

```bash
curl -i https://api.scraplab.cc.cd/auth/v1/health
```

返回 `200` 即部署完成。

---

## 修改 App 配置

部署完成后，把 App 的 Supabase 地址从 `*.supabase.co` 改为代理域名。

### 1. 修改 `.env`

```env
EXPO_PUBLIC_SUPABASE_URL=https://api.scraplab.cc.cd
```

> `EXPO_PUBLIC_SUPABASE_ANON_KEY` 保持不变。

### 2. 修改 `eas.json`

在 `preview` 和 `production` 两个 profile 的 `env` 中，同步修改：

```json
"env": {
  "EXPO_PUBLIC_SUPABASE_URL": "https://api.scraplab.cc.cd",
  "EXPO_PUBLIC_SUPABASE_ANON_KEY": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### 3. 重新打包

```bash
npx eas build --platform android --profile preview
```

---

## 常见问题

### Q1：`curl` 测试返回 502 / proxy_error

Worker 无法连到 Supabase。检查：

- `wrangler.toml` 中 `SUPABASE_HOST` 是否正确
- Supabase 项目是否处于活跃状态（免费项目长期不用会被暂停）

### Q2：返回 401 / 403

Supabase 的 `apikey` 校验失败。确认 App 请求头带了正确的 `apikey` 和 `Authorization`。Worker 会原样透传这些头。

### Q3：Realtime（实时）不工作

WebSocket 需要 Worker 支持 Upgrade 头。本 Worker 已处理（见 [`src/index.js`](src/index.js:71)）。若仍失败，检查自定义域名是否开启了 Cloudflare 的 **WebSocket** 支持（默认开启）。

### Q4：Storage 上传大文件失败

Cloudflare 免费版 Worker 有请求体大小限制（100 MB）。一般头像/音频上传不受影响。

### Q5：想换回直连

把 `.env` 和 `eas.json` 中的 `EXPO_PUBLIC_SUPABASE_URL` 改回 `https://cqpszvmritgldvzhlbds.supabase.co` 即可。

---

## 文件说明

| 文件 | 作用 |
|------|------|
| [`src/index.js`](src/index.js:1) | Worker 主逻辑：转发请求 + CORS |
| [`wrangler.toml`](wrangler.toml:1) | 部署配置：Worker 名称、环境变量、路由 |
| [`package.json`](package.json:1) | 依赖与脚本（dev / deploy / tail） |

---

## 安全提示

- Worker 只做**透明转发**，不存储任何数据，不修改请求体。
- Supabase 的鉴权仍由 `apikey` + JWT 完成，代理不会降低安全性。
- 如需限制来源，可把 [`src/index.js`](src/index.js:36) 中的 `ALLOWED_ORIGIN` 从 `'*'` 改为具体域名。
