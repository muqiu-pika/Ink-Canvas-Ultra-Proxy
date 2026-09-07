import { renderHome } from './_lib/home.js';

/**
 * 首页：/ 。
 * 仅输出静态说明页，不涉及任何回源。
 */
export default function onRequest(context) {
  const url = new URL(context.request.url);
  return new Response(renderHome(url.origin), {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=300',
      'access-control-allow-origin': '*',
    },
  });
}
