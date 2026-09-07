import { handleProxy, pickPath } from '../_lib/proxy.js';

/**
 * 主入口：/gh/* —— 捕获 gh 下的所有路径段。
 *
 * 例：
 *   /gh/https://github.com/muqiu-pika/Ink-Canvas-Ultra/releases/download/v26.9.4/x.exe
 *   /gh/raw/muqiu-pika/Ink-Canvas-Ultra-Plugin/main/market/v1/market.json
 *
 * 注意：路径一律通过 pickPath() 从 request.url 的 pathname 取，不再依赖
 * context.params.default —— 平台对 catch-all 参数的类型并不统一（字符串 / 数组都可能），
 * 直接取 pathname 最稳，且兼容「gh/ 前缀是否已被平台剥离」两种情况。
 */
export default async function onRequest(context) {
  return handleProxy(context.request, context.env, pickPath(context));
}
