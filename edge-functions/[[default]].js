import { renderHome } from './_lib/home.js';
import { handleProxy } from './_lib/proxy.js';

/**
 * 兼容入口：根级 catch-all，捕获除静态资源与显式路由（/health）之外的所有路径。
 *
 * 存在的意义：有些客户端 / 教程会按 gh-proxy 的习惯把完整 URL 直接拼在域名后面，
 * 即 https://<host>/https://github.com/... ，而不是放在 /gh/ 下。
 * 这里一并接住（normalizePath 会剥掉多余的 gh/ 前缀），保证两种写法都能用。
 *
 * 说明：静态资源与静态路由优先级高于本文件，因此不会影响 index/health/public 下的文件。
 */
export default async function onRequest(context) {
  const p = (context.params && context.params.default) || '';
  if (p.trim().length === 0) {
    return new Response(renderHome(new URL(context.request.url).origin), {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'public, max-age=300',
        'access-control-allow-origin': '*',
      },
    });
  }
  return handleProxy(context.request, context.env, p);
}
