/**
 * 本地自检：不联网验证「路径解析 + 白名单 + 上游 URL + 缓存策略 + 错误分支」。
 * 用法：node tools/selftest.mjs
 */
import { normalizePath, parseTarget, checkPolicy, buildUpstreamUrl, cacheControlFor } from '../edge-functions/_lib/parser.js';
import { handleProxy, pickPath } from '../edge-functions/_lib/proxy.js';

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + '\n        expected: ' + expected + '\n        actual:   ' + actual); }
}

function resolve(p) {
  const n = normalizePath(p);
  const t = parseTarget(n);
  if (!t.ok) return { allow: false, reason: t.reason, kind: '-', url: '-', cache: '-' };
  const c = checkPolicy(t);
  return {
    allow: c.ok,
    reason: c.ok ? (c.rule && c.rule.desc) : c.reason,
    kind: t.kind,
    url: c.ok ? buildUpstreamUrl(t) : '-',
    cache: c.ok ? cacheControlFor(t, buildUpstreamUrl(t), {}) : '-',
  };
}

console.log('\n== 路径解析与白名单 ==');
let r;

r = resolve('/gh/https://github.com/muqiu-pika/Ink-Canvas-Ultra/releases/download/v26.9.2/Ink.Canvas.Ultra.V26.9.2.Setup.exe');
check('ICU 安装包（完整 URL 直拼）', r.allow, true);
check('  → 上游 URL', r.url, 'https://github.com/muqiu-pika/Ink-Canvas-Ultra/releases/download/v26.9.2/Ink.Canvas.Ultra.V26.9.2.Setup.exe');
check('  → 缓存', r.cache, 'public, max-age=604800, immutable');

r = resolve('/gh/https:/github.com/muqiu-pika/Ink-Canvas-Ultra/releases/download/v26.9.2/Ink.Canvas.Ultra.V26.9.2.Setup.exe');
check('ICU 安装包（双斜杠被折叠成单斜杠）', r.allow, true);

r = resolve('https://raw.githubusercontent.com/muqiu-pika/Ink-Canvas-Ultra/master/AutomaticUpdateVersionControl.txt');
check('ICU 版本检测文件（根级 catch-all 形态）', r.allow, true);
check('  → 上游 URL', r.url, 'https://raw.githubusercontent.com/muqiu-pika/Ink-Canvas-Ultra/master/AutomaticUpdateVersionControl.txt');
check('  → 缓存', r.cache, 'public, max-age=60');

r = resolve('/gh/https://github.com/muqiu-pika/Ink-Canvas-Ultra/blob/master/AutomaticUpdateVersionControl.txt');
check('ICU 版本检测文件（blob 页面链接）', r.allow, true);

r = resolve('/gh/raw/muqiu-pika/Ink-Canvas-Ultra-Plugin/main/market/v1/market.json');
check('插件市场目录（简洁路径）', r.allow, true);
check('  → 上游 URL', r.url, 'https://raw.githubusercontent.com/muqiu-pika/Ink-Canvas-Ultra-Plugin/main/market/v1/market.json');
check('  → 缓存', r.cache, 'public, max-age=60');

r = resolve('/gh/raw/muqiu-pika/Ink-Canvas-Ultra-Plugin/main/documenttoimage.icplugin');
check('插件安装包 .icplugin', r.allow, true);
check('  → 缓存', r.cache, 'public, max-age=60');

r = resolve('/gh/raw/muqiu-pika/Ink-Canvas-Ultra-Plugin/main/market/v1/plugins/toolbarreorder/changelog.md');
check('插件市场 changelog.md', r.allow, true);

console.log('\n== 应当被拒绝的请求 ==');
r = resolve('/gh/raw/muqiu-pika/Ink-Canvas-Ultra-Plugin/main/README.md');
check('插件仓库 README.md', r.allow, false);
r = resolve('/gh/raw/muqiu-pika/Ink-Canvas-Ultra/master/README.md');
check('主程序仓库 README.md', r.allow, false);
r = resolve('/gh/https://github.com/muqiu-pika/Ink-Canvas-Ultra/archive/refs/heads/master.zip');
check('主程序源码 zip', r.allow, false);
r = resolve('/gh/https://github.com/torvalds/linux/releases/download/v1/v.zip');
check('白名单外仓库', r.allow, false);
r = resolve('/gh/raw/muqiu-pika/Ink-Canvas-Ultra/dev/AutomaticUpdateVersionControl.txt');
check('非白名单分支 dev', r.allow, false);
r = resolve('/gh/releases/muqiu-pika/Ink-Canvas-Ultra-Plugin/v1.0.0/Source code.zip');
check('插件仓库非 icplugin 资产', r.allow, false);
r = resolve('/gh/https://objects.githubusercontent.com/github-production/abc');
check('objects.githubusercontent.com 直链', r.allow, false);
r = resolve('/favicon.ico');
check('静态资源路径', r.allow, false);

console.log('\n== 其它形态 ==');
r = resolve('/gh/https://github.com/muqiu-pika/Ink-Canvas-Ultra/releases/latest/download/Ink.Canvas.Ultra.Setup.exe');
check('releases/latest/download', r.allow, true);
check('  → 上游 URL', r.url, 'https://github.com/muqiu-pika/Ink-Canvas-Ultra/releases/latest/download/Ink.Canvas.Ultra.Setup.exe');
r = resolve('/gh/releases/muqiu-pika/Ink-Canvas-Ultra-Plugin/v1.0.0/toolbarreorder.icplugin');
check('插件仓库 releases 里的 .icplugin', r.allow, true);

console.log('\n== 真实请求形态（pathname / 数组 / 完整 URL） ==');
// 平台侧 catch-all 参数形态不统一，这里覆盖 pickPath 与三种入参形态
const ctx = {
  request: new Request('https://gh.muqiu.eu.org/gh/raw/muqiu-pika/Ink-Canvas-Ultra/master/AutomaticUpdateVersionControl.txt'),
  params: { default: 'raw/muqiu-pika/Ink-Canvas-Ultra/master/AutomaticUpdateVersionControl.txt' },
};
check('pickPath 取自 pathname', pickPath(ctx), '/gh/raw/muqiu-pika/Ink-Canvas-Ultra/master/AutomaticUpdateVersionControl.txt');
r = resolve(pickPath(ctx));
check('线上真实路径（版本检测）', r.allow, true);
check('  → 上游 URL', r.url, 'https://raw.githubusercontent.com/muqiu-pika/Ink-Canvas-Ultra/master/AutomaticUpdateVersionControl.txt');

const ctx2 = {
  request: new Request('https://gh.muqiu.eu.org/gh/raw/muqiu-pika/Ink-Canvas-Ultra-Plugin/main/market/v1/market.json'),
};
r = resolve(pickPath(ctx2));
check('线上真实路径（市场目录）', r.allow, true);
check('  → 上游 URL', r.url, 'https://raw.githubusercontent.com/muqiu-pika/Ink-Canvas-Ultra-Plugin/main/market/v1/market.json');

// catch-all 参数若是数组（部分平台行为），也必须能解析
r = resolve(['raw', 'muqiu-pika', 'Ink-Canvas-Ultra', 'master', 'AutomaticUpdateVersionControl.txt']);
check('params 为数组形态', r.allow, true);

// 完整 URL 形态（根级 catch-all 直拼风格 / 客户端直接传入）
r = resolve('https://gh.muqiu.eu.org/gh/raw/muqiu-pika/Ink-Canvas-Ultra/master/AutomaticUpdateVersionControl.txt');
check('完整 URL（带 host 与 gh 前缀）', r.allow, true);
r = resolve('https://gh.muqiu.eu.org/https://github.com/muqiu-pika/Ink-Canvas-Ultra/releases/download/v26.9.4/Ink.Canvas.Ultra.V26.9.4.Setup.exe');
check('完整 URL（直拼 GitHub 链接）', r.allow, true);
check('  → 上游 URL', r.url, 'https://github.com/muqiu-pika/Ink-Canvas-Ultra/releases/download/v26.9.4/Ink.Canvas.Ultra.V26.9.4.Setup.exe');

// 带 query / 尾部斜杠不应影响解析
r = resolve('/gh/raw/muqiu-pika/Ink-Canvas-Ultra/master/AutomaticUpdateVersionControl.txt?t=1');
check('带 query 参数', r.allow, true);

// 平台对 catch-all 参数做 URL 编码后传入（斜杠变成 %2F）
r = resolve('gh%2Fraw%2Fmuqiu-pika%2FInk-Canvas-Ultra%2Fmaster%2FAutomaticUpdateVersionControl.txt');
check('参数被 URL 编码（%2F）', r.allow, true);
check(
  '  → 上游 URL',
  r.url,
  'https://raw.githubusercontent.com/muqiu-pika/Ink-Canvas-Ultra/master/AutomaticUpdateVersionControl.txt'
);

console.log('\n== handleProxy（不触网的分支） ==');
const mk = (url, method = 'GET') => new Request(url, { method, headers: { accept: 'application/json' } });
let resp = await handleProxy(mk('https://x.test/gh/raw/muqiu-pika/Ink-Canvas-Ultra-Plugin/main/README.md'), {}, 'raw/muqiu-pika/Ink-Canvas-Ultra-Plugin/main/README.md');
check('越权文件 → 403', resp.status, 403);
resp = await handleProxy(mk('https://x.test/gh/raw/muqiu-pika/Ink-Canvas-Ultra-Plugin/main/README.md', 'POST'), {}, 'raw/muqiu-pika/Ink-Canvas-Ultra-Plugin/main/README.md');
check('POST → 405', resp.status, 405);
resp = await handleProxy(mk('https://x.test/gh/nonsense'), {}, 'nonsense');
check('无法解析 → 400', resp.status, 400);
resp = await handleProxy(mk('https://x.test/gh/raw/muqiu-pika/Ink-Canvas-Ultra/master/AutomaticUpdateVersionControl.txt?token=wrong'), { PROXY_TOKEN: 'abc' }, 'raw/muqiu-pika/Ink-Canvas-Ultra/master/AutomaticUpdateVersionControl.txt');
check('启用 PROXY_TOKEN 且令牌错误 → 401', resp.status, 401);

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败\n');
process.exit(fail === 0 ? 0 : 1);
