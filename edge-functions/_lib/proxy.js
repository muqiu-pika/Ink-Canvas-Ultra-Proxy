/**
 * 代理核心：校验 → 回源 → 流式回传
 * ---------------------------------------------------------------------------
 * 两条硬约束决定了这里的写法（EdgeOne Edge Functions 限制）：
 *   1. 运行内存 128 MB —— 绝不能把上游响应读进内存再返回，必须原样转发 body 流。
 *      安装包几十 MB，一旦 arrayBuffer() 必然 OOM。
 *   2. 单次 CPU 时间 200 ms（不含 I/O 等待）—— 不能对流做任何逐块加工，
 *      直接把 resp.body 交给 Response，由运行时零拷贝透传，CPU 几乎不消耗。
 *
 * 因此这里只做"头部加工"，body 永远是一路流过去的。
 */

import {
  PROXY_NAME,
  PROXY_VERSION,
  DEFAULT_UA,
  UPSTREAM_TIMEOUT_MS,
  FORWARD_REQUEST_HEADERS,
  STRIP_RESPONSE_HEADERS,
} from './config.js';
import {
  normalizePath,
  parseTarget,
  checkPolicy,
  buildUpstreamUrl,
  cacheControlFor,
} from './parser.js';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function wantsJson(request) {
  const accept = String(request.headers.get('accept') || '');
  return accept.indexOf('application/json') >= 0;
}

function commonHeaders(extra = {}) {
  return Object.assign(
    {
      'access-control-allow-origin': '*',
      'access-control-expose-headers': 'content-length, content-disposition, etag, last-modified',
      'x-proxy-by': `${PROXY_NAME}/${PROXY_VERSION}`,
    },
    extra
  );
}

export function jsonResponse(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: commonHeaders(Object.assign({}, JSON_HEADERS, extra)),
  });
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function errorResponse(request, status, message, detail) {
  if (wantsJson(request)) {
    return jsonResponse({ error: true, status, message, detail: detail || null }, status);
  }
  const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${status} - ${escapeHtml(message)}</title>
<style>
body{font-family:-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;background:#f5f7fa;color:#1f2937;margin:0;padding:48px 24px}
.box{max-width:680px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;box-shadow:0 2px 12px rgba(0,0,0,.06)}
h1{font-size:20px;margin:0 0 12px}
p{margin:8px 0;line-height:1.7}
code{background:#f3f4f6;padding:2px 6px;border-radius:4px;font-size:13px;word-break:break-all}
a{color:#2563eb}
</style></head><body><div class="box">
<h1>${status} · ${escapeHtml(message)}</h1>
${detail ? `<p><code>${escapeHtml(detail)}</code></p>` : ''}
<p><a href="/">返回首页</a> · <a href="/health">查看白名单</a></p>
</div></body></html>`;
  return new Response(html, {
    status,
    headers: commonHeaders({ 'content-type': 'text/html; charset=utf-8' }),
  });
}

/** 构造回源请求头：只放行白名单里的几个，并强制 identity 编码。 */
function buildUpstreamHeaders(request) {
  const h = new Headers();
  const ua = request.headers.get('user-agent');
  h.set('user-agent', ua && ua.length > 0 ? ua : DEFAULT_UA);
  h.set('accept', request.headers.get('accept') || '*/*');
  // 关键：强制不压缩。ICU 用的 .NET HttpClient 未开启自动解压，
  // 若上游给 gzip 内容，客户端会直接拿到压缩字节导致版本检测解析失败。
  h.set('accept-encoding', 'identity');
  for (let i = 0; i < FORWARD_REQUEST_HEADERS.length; i++) {
    const name = FORWARD_REQUEST_HEADERS[i];
    const v = request.headers.get(name);
    if (v) h.set(name, v);
  }
  return h;
}

function cleanResponseHeaders(headers, cacheControl, upstreamUrl) {
  for (let i = 0; i < STRIP_RESPONSE_HEADERS.length; i++) {
    headers.delete(STRIP_RESPONSE_HEADERS[i]);
  }
  headers.set('access-control-allow-origin', '*');
  headers.set('access-control-expose-headers', 'content-length, content-disposition, etag, last-modified');
  headers.set('cache-control', cacheControl);
  headers.set('x-proxy-by', `${PROXY_NAME}/${PROXY_VERSION}`);
  headers.set('x-upstream', upstreamUrl);
  return headers;
}

/**
 * 处理一次代理请求。
 * @param {Request} request  客户端请求
 * @param {object} env       Pages 环境变量
 * @param {string} rawPath   catch-all 捕获到的路径
 */
export async function handleProxy(request, env, rawPath) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: commonHeaders({
        'access-control-allow-methods': 'GET, HEAD, OPTIONS',
        'access-control-max-age': '86400',
      }),
    });
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return errorResponse(request, 405, '只允许 GET / HEAD 请求', `收到 ${request.method}`);
  }

  // 可选访问令牌：在 Pages 环境变量里配置 PROXY_TOKEN 后才会启用
  const token = env && env.PROXY_TOKEN;
  if (token) {
    const url = new URL(request.url);
    const provided = url.searchParams.get('token') || request.headers.get('x-proxy-token');
    if (provided !== token) {
      return errorResponse(request, 401, '缺少或错误的访问令牌', '请在 URL 后附加 ?token=<PROXY_TOKEN>');
    }
  }

  const normalized = normalizePath(rawPath);
  const target = parseTarget(normalized);
  if (!target.ok) {
    return errorResponse(request, 400, '无法解析的代理路径', target.reason);
  }

  const policy = checkPolicy(target);
  if (!policy.ok) {
    return errorResponse(request, policy.code, '该资源不在代理白名单内', policy.reason);
  }

  const upstreamUrl = buildUpstreamUrl(target);
  const cacheControl = cacheControlFor(target, upstreamUrl, env);

  let upstreamResponse;
  try {
    const init = {
      method: request.method,
      headers: buildUpstreamHeaders(request),
      redirect: 'follow',
    };
    // AbortSignal.timeout 在部分运行时不存在，做能力检测
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      init.signal = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);
    }
    upstreamResponse = await fetch(upstreamUrl, init);
  } catch (e) {
    return errorResponse(request, 502, '回源失败', `${upstreamUrl} → ${e && e.message ? e.message : e}`);
  }

  if (!upstreamResponse) {
    return errorResponse(request, 502, '回源失败', `${upstreamUrl} → 上游无响应`);
  }

  const headers = cleanResponseHeaders(new Headers(upstreamResponse.headers), cacheControl, upstreamUrl);

  // 上游 5xx 统一报 502，避免把 GitHub 的错误页面直接吐给用户
  const status = upstreamResponse.status >= 500 ? 502 : upstreamResponse.status;
  const body = request.method === 'HEAD' ? null : upstreamResponse.body;

  return new Response(body, {
    status,
    statusText: upstreamResponse.statusText || '',
    headers,
  });
}
