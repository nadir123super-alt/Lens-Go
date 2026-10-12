# Supabase 反向代理（Cloudflare Pages Functions）

## 为什么用 Pages 而不是 Worker

实测国内网络对不同域名的阻断情况：

| 域名 | 结果 | 说明 |
|------|------|------|
| `*.supabase.co` | ❌ 000 | TLS 握手被重置 |
| `*.workers.dev` | ❌ 000 | 连接超时 |
| `*.cc.cd`（scraplab.cc.cd） | ❌ 000 | TLS 握手被重置 |
| `*.pages.dev` | ✅ 200 | **可正常访问** |
| `cloudflare.com` | ✅ 200 | Cloudflare IP 段本身正常 |

结论：GFW 对 `supabase.co`、`workers.dev`、`cc.cd` 做了 SNI 阻断，但 `pages.dev` 未被阻断。
因此改用 **Cloudflare Pages Functions** 做反向代理。

## 当前部署信息

| 项目 | 值 |
|------|-----|
| Pages 项目名 | `supabase-proxy-pages` |
| 生产域名 | `https://supabase-proxy-pages-2nj.pages.dev` |
| 目标 Supabase | `cqpszvmritgldvzhlbds.supabase.co` |
| 健康检查 | https://supabase-proxy-pages-2nj.pages.dev/auth/v1/health |

## 工作原理

```
App 请求  https://supabase-proxy-pages-2nj.pages.dev/auth/v1/token
  → Pages Function 转发到  https://cqpszvmritgldvzhlbds.supabase.co/auth/v1/token
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

## 文件说明

| 文件 | 作用 |
|------|------|
| [`functions/[[path]].js`](functions/[[path]].js:1) | Pages Function 主逻辑：捕获所有路径并转发 |
| [`_routes.json`](_routes.json:1) | 路由规则：所有请求都走 Functions |
| [`index.html`](index.html:1) | 占位首页（显示服务状态） |
| [`wrangler.toml`](wrangler.toml:1) | 部署配置：项目名、环境变量 |
| [`package.json`](package.json:1) | 依赖与脚本（dev / deploy） |

## 重新部署

修改代码后，在 `cloudflare-pages/` 目录执行：

```bash
cd cloudflare-pages
wrangler pages deploy . --project-name=supabase-proxy-pages --branch=main
```

## 本地调试

```bash
cd cloudflare-pages
npm install
npm run dev
```

本地启动 `http://localhost:8787`，测试：

```bash
curl -i http://localhost:8787/auth/v1/health
```

## 验证代理是否正常

```bash
curl -s -H "apikey: <你的_ANON_KEY>" \
  https://supabase-proxy-pages-2nj.pages.dev/auth/v1/health
```

正常应返回：

```json
{"version":"v2.197.0","name":"GoTrue","description":"GoTrue is a user registration and authentication API"}
```

## App 配置

App 的 `.env` 和 `eas.json` 已指向代理域名：

```env
EXPO_PUBLIC_SUPABASE_URL=https://supabase-proxy-pages-2nj.pages.dev
```

`EXPO_PUBLIC_SUPABASE_ANON_KEY` 保持不变。

修改后需重新打包：

```bash
npx eas build --platform android --profile preview
```

## 常见问题

### Q1：返回 401 / UNAUTHORIZED_MISSING_API_KEY

正常现象。健康检查端点需要 `apikey` 请求头。带上 anon key 即可。

### Q2：返回 502 / proxy_error

Pages Function 无法连到 Supabase。检查：

- `wrangler.toml` 中 `SUPABASE_HOST` 是否正确
- Supabase 项目是否处于活跃状态（免费项目长期不用会被暂停）

### Q3：Realtime（实时）不工作

WebSocket 需要 Function 支持 Upgrade 头。本实现已处理（见 [`functions/[[path]].js`](functions/[[path]].js:71)）。

### Q4：想换回直连

把 `.env` 和 `eas.json` 中的 `EXPO_PUBLIC_SUPABASE_URL` 改回
`https://cqpszvmritgldvzhlbds.supabase.co` 即可（但国内会被阻断）。

### Q5：想绑定自己的域名

如果以后有了国内可访问的域名，可在 Cloudflare Dashboard →
Pages → `supabase-proxy-pages` → **Custom domains** 添加。

## 安全提示

- Function 只做**透明转发**，不存储任何数据，不修改请求体。
- Supabase 的鉴权仍由 `apikey` + JWT 完成，代理不会降低安全性。
- 如需限制来源，可把 [`functions/[[path]].js`](functions/[[path]].js:36) 中的
  `ALLOWED_ORIGIN` 从 `'*'` 改为具体域名。
