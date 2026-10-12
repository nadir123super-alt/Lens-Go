/**
 * Cloudflare Worker — Supabase 反向代理
 *
 * 目的：
 *   中国大陆访问 *.supabase.co 会被 GFW 阻断（DNS 正常但 TLS 握手被重置）。
 *   本 Worker 部署在 Cloudflare 边缘节点，通过自定义域名（如 api.scraplab.cc.cd）
 *   代理所有 Supabase 请求，绕过对 *.supabase.co 的封锁。
 *
 * 原理：
 *   App 请求  https://api.scraplab.cc.cd/auth/v1/token
 *     → Worker 转发到  https://cqpszvmritgldvzhlbds.supabase.co/auth/v1/token
 *     → 原样返回响应
 *
 * 支持：
 *   - REST API（/rest/v1/*）
 *   - Auth（/auth/v1/*）
 *   - Storage（/storage/v1/*）
 *   - Edge Functions（/functions/v1/*）
 *   - Realtime WebSocket（/realtime/v1/*）
 *
 * 部署：
 *   1. 安装 wrangler: npm install -g wrangler
 *   2. 登录: wrangler login
 *   3. 修改 wrangler.toml 中的 SUPABASE_HOST 和路由
 *   4. 部署: wrangler deploy
 */

// ============================================================
// 配置：目标 Supabase 项目
// ============================================================
// 可通过环境变量覆盖（wrangler.toml 的 [vars] 或 wrangler secret）
const DEFAULT_SUPABASE_HOST = 'cqpszvmritgldvzhlbds.supabase.co';

// 允许的请求来源（CORS）。'*' 表示允许所有来源。
// 生产环境建议改为具体域名，如 'https://scraplab.cc.cd'
const ALLOWED_ORIGIN = '*';

export default {
  /**
   * Worker 入口
   * @param {Request} request  - 客户端请求
   * @param {Object}  env      - 环境变量（wrangler.toml 的 [vars]）
   * @param {Object}  ctx      - 执行上下文
   */
  async fetch(request, env, ctx) {
    const supabaseHost = env.SUPABASE_HOST || DEFAULT_SUPABASE_HOST;

    const url = new URL(request.url);

    // 构造目标 URL：保留 path、query，替换 host
    const targetUrl = new URL(request.url);
    targetUrl.protocol = 'https:';
    targetUrl.host = supabaseHost;

    // 复制请求头，修正 Host 和 Origin
    const headers = new Headers(request.headers);
    headers.set('Host', supabaseHost);
    // 移除可能引起 Supabase 校验失败的来源头
    headers.delete('Origin');
    headers.delete('Referer');

    // 构造转发请求
    const proxyRequest = new Request(targetUrl.toString(), {
      method: request.method,
      headers,
      body: request.body,
      redirect: 'manual',
    });

    // 处理 WebSocket 升级（Realtime）
    if (request.headers.get('Upgrade') === 'websocket') {
      return fetch(proxyRequest);
    }

    try {
      const response = await fetch(proxyRequest);

      // 构造响应，添加 CORS 头
      const responseHeaders = new Headers(response.headers);
      responseHeaders.set('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
      responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      responseHeaders.set(
        'Access-Control-Allow-Headers',
        'apikey, authorization, content-type, x-client-info, x-supabase-api-version, prefer, accept-profile, content-profile, range, x-upsert'
      );
      responseHeaders.set('Access-Control-Expose-Headers', 'content-range, x-total-count');
      responseHeaders.set('Access-Control-Max-Age', '86400');

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    } catch (err) {
      return new Response(
        JSON.stringify({
          error: 'proxy_error',
          message: `无法连接到 Supabase: ${err.message}`,
          target: targetUrl.toString(),
        }),
        {
          status: 502,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
          },
        }
      );
    }
  },
};
