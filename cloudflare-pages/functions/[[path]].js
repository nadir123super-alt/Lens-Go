/**
 * Cloudflare Pages Functions — Supabase 反向代理
 *
 * 为什么用 Pages 而不是 Worker：
 *   - *.workers.dev 域名在国内被 SNI 阻断（已实测 000）
 *   - *.pages.dev 域名可正常访问（已实测 200）
 *   - Pages Functions 与 Worker 同一套运行时，免费、无限请求
 *
 * 原理：
 *   App 请求  https://<项目名>.pages.dev/auth/v1/token
 *     → 本函数转发到  https://cqpszvmritgldvzhlbds.supabase.co/auth/v1/token
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
 *   1. wrangler pages project create supabase-proxy-pages
 *   2. wrangler pages deploy . --project-name=supabase-proxy-pages
 *   3. 把 App 的 EXPO_PUBLIC_SUPABASE_URL 改为 https://supabase-proxy-pages.pages.dev
 */

// ============================================================
// 配置：目标 Supabase 项目
// ============================================================
// 可通过 Pages 环境变量 SUPABASE_HOST 覆盖
const DEFAULT_SUPABASE_HOST = 'cqpszvmritgldvzhlbds.supabase.co';

// 允许的请求来源（CORS）。'*' 表示允许所有来源。
const ALLOWED_ORIGIN = '*';

/**
 * Pages Functions 入口
 * @param {Object} context
 * @param {Request} context.request - 客户端请求
 * @param {Object}  context.env     - 环境变量
 * @param {Object}  context.params  - 路由参数（[[path]] 捕获的路径段）
 */
export async function onRequest(context) {
  const { request, env } = context;

  const supabaseHost = env.SUPABASE_HOST || DEFAULT_SUPABASE_HOST;

  // 处理 CORS 预检请求
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(),
    });
  }

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
    for (const [key, value] of Object.entries(corsHeaders())) {
      responseHeaders.set(key, value);
    }

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
          ...corsHeaders(),
        },
      }
    );
  }
}

/**
 * 统一的 CORS 响应头
 */
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers':
      'apikey, authorization, content-type, x-client-info, x-supabase-api-version, prefer, accept-profile, content-profile, range, x-upsert',
    'Access-Control-Expose-Headers': 'content-range, x-total-count',
    'Access-Control-Max-Age': '86400',
  };
}
