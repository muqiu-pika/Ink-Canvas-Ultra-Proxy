import { PROXY_NAME, PROXY_VERSION, REPO_POLICY, CACHE_POLICY } from './_lib/config.js';
import { jsonResponse } from './_lib/proxy.js';

/**
 * 自检接口：/health
 * 返回当前生效的白名单、缓存策略与示例链接，部署后先打开这个确认配置是否符合预期。
 */
export default function onRequest(context) {
  const origin = new URL(context.request.url).origin;
  const repos = Object.keys(REPO_POLICY).map((key) => {
    const p = REPO_POLICY[key];
    return {
      repo: key,
      display: p.display,
      allowedRefs: p.allowedRefs,
      rawRules: p.rawRules.map((r) => ({ type: r.type, value: r.value, desc: r.desc })),
      releaseDesc: p.releaseDesc,
    };
  });

  return jsonResponse({
    ok: true,
    name: PROXY_NAME,
    version: PROXY_VERSION,
    methods: ['GET', 'HEAD'],
    repos,
    cache: {
      versionFile: CACHE_POLICY.versionFile.value,
      market: CACHE_POLICY.market.value,
      plugin: CACHE_POLICY.plugin.value,
      release: CACHE_POLICY.release.value,
      fallback: CACHE_POLICY.fallback,
    },
    examples: {
      versionFile: `${origin}/gh/raw/muqiu-pika/Ink-Canvas-Ultra/master/AutomaticUpdateVersionControl.txt`,
      release: `${origin}/gh/releases/muqiu-pika/Ink-Canvas-Ultra/v26.9.2/Ink.Canvas.Ultra.V26.9.2.Setup.exe`,
      market: `${origin}/gh/raw/muqiu-pika/Ink-Canvas-Ultra-Plugin/main/market/v1/market.json`,
      plugin: `${origin}/gh/raw/muqiu-pika/Ink-Canvas-Ultra-Plugin/main/documenttoimage.icplugin`,
    },
  });
}
