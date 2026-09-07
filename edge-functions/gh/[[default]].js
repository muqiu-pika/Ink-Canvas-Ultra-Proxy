import { handleProxy } from '../_lib/proxy.js';

/**
 * 主入口：/gh/* —— 捕获 gh 下的所有路径段。
 *
 * 例：
 *   /gh/https://github.com/muqiu-pika/Ink-Canvas-Ultra/releases/download/v26.9.2/x.exe
 *   /gh/raw/muqiu-pika/Ink-Canvas-Ultra-Plugin/main/market/v1/market.json
 */
export default async function onRequest(context) {
  return handleProxy(context.request, context.env, context.params && context.params.default);
}
