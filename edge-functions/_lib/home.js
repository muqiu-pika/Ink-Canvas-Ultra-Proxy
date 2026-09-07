/**
 * 首页 / 使用说明（纯 HTML，由 edge-functions/index.js 直接返回）
 */

import { PROXY_NAME, PROXY_VERSION, REPO_POLICY } from './config.js';

function ruleText(rule) {
  if (rule.type === 'exact') return `精确匹配 <code>${rule.value}</code>`;
  if (rule.type === 'prefix') return `前缀 <code>${rule.value}*</code>`;
  if (rule.type === 'suffix') return `后缀 <code>*${rule.value}</code>`;
  return `正则 <code>${rule.value}</code>`;
}

function repoCards() {
  const keys = Object.keys(REPO_POLICY);
  let out = '';
  for (let i = 0; i < keys.length; i++) {
    const p = REPO_POLICY[keys[i]];
    out += `<div class="card">
      <h3>${p.display}</h3>
      <p class="muted"><a href="${p.homepage}" target="_blank" rel="noreferrer">${p.homepage}</a></p>
      <p><span class="tag">分支</span> ${(p.allowedRefs || []).join(' / ')}</p>
      <p><span class="tag">文件</span> ${p.rawRules.map(ruleText).join(' ；')}</p>
      <p><span class="tag">Release</span> ${p.releaseDesc}</p>
    </div>`;
  }
  return out;
}

export function renderHome(origin) {
  const base = origin || '';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${PROXY_NAME}</title>
<style>
*{box-sizing:border-box}
body{font-family:-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Microsoft YaHei",sans-serif;margin:0;padding:0;background:#f5f7fa;color:#1f2937;line-height:1.7}
.wrap{max-width:860px;margin:0 auto;padding:48px 24px 72px}
h1{font-size:26px;margin:0 0 6px}
.sub{color:#6b7280;margin:0 0 28px;font-size:14px}
.card{background:#fff;border-radius:12px;padding:20px 22px;margin-bottom:16px;box-shadow:0 1px 8px rgba(0,0,0,.05)}
.card h3{margin:0 0 6px;font-size:17px}
.card p{margin:6px 0;font-size:14px}
.muted{color:#6b7280;font-size:13px}
code{background:#f3f4f6;padding:2px 6px;border-radius:4px;font-size:12.5px;word-break:break-all}
pre{background:#0f172a;color:#e5e7eb;padding:14px 16px;border-radius:10px;overflow-x:auto;font-size:12.5px;line-height:1.7}
.tag{display:inline-block;background:#eef2ff;color:#4338ca;border-radius:6px;padding:1px 8px;font-size:12px;margin-right:6px}
a{color:#2563eb;text-decoration:none}
a:hover{text-decoration:underline}
form{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}
input[type=text]{flex:1;min-width:260px;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px}
button{padding:10px 18px;border:0;border-radius:8px;background:#2563eb;color:#fff;font-size:14px;cursor:pointer}
button:hover{background:#1d4ed8}
ul{margin:8px 0;padding-left:20px}
li{margin:4px 0;font-size:14px}
.foot{color:#9ca3af;font-size:12.5px;margin-top:28px}
</style>
</head>
<body>
<div class="wrap">
  <h1>${PROXY_NAME}</h1>
  <p class="sub">仅服务于 Ink Canvas Ultra 的更新与插件分发的 GitHub 只读反向代理 · v${PROXY_VERSION}</p>

  <div class="card">
    <h3>粘贴 GitHub 链接</h3>
    <form onsubmit="event.preventDefault();go();">
      <input type="text" id="u" placeholder="https://github.com/muqiu-pika/Ink-Canvas-Ultra/releases/download/...">
      <button type="submit">生成加速链接</button>
    </form>
    <p class="muted">只处理下面白名单里的仓库与文件，其余一律返回 403。</p>
  </div>

  <div class="card">
    <h3>URL 写法</h3>
    <pre># 前缀直拼（gh-proxy 风格，ICU「自动更新代理」设置项直接用这种）
${base}/gh/https://github.com/muqiu-pika/Ink-Canvas-Ultra/releases/download/v26.9.2/Ink.Canvas.Ultra.V26.9.2.Setup.exe
${base}/gh/https://raw.githubusercontent.com/muqiu-pika/Ink-Canvas-Ultra/master/AutomaticUpdateVersionControl.txt

# 简洁写法（推荐，便于长期维护）
${base}/gh/raw/muqiu-pika/Ink-Canvas-Ultra-Plugin/main/market/v1/market.json
${base}/gh/raw/muqiu-pika/Ink-Canvas-Ultra-Plugin/main/documenttoimage.icplugin
${base}/gh/releases/muqiu-pika/Ink-Canvas-Ultra/v26.9.2/Ink.Canvas.Ultra.V26.9.2.Setup.exe</pre>
    <p class="muted">即使在传输过程中 <code>https://</code> 的双斜杠被折叠成单斜杠，代理同样可以识别。</p>
  </div>

  <div class="card">
    <h3>白名单</h3>
    ${repoCards()}
  </div>

  <div class="card">
    <h3>自检</h3>
    <ul>
      <li><a href="${base}/health">${base}/health</a> — 返回白名单与示例（JSON）</li>
      <li><a href="${base}/gh/raw/muqiu-pika/Ink-Canvas-Ultra/master/AutomaticUpdateVersionControl.txt">版本检测文件</a></li>
      <li><a href="${base}/gh/raw/muqiu-pika/Ink-Canvas-Ultra-Plugin/main/market/v1/market.json">插件市场目录</a></li>
    </ul>
  </div>

  <p class="foot">本页面与代理逻辑均运行在 EdgeOne Pages 边缘函数上，只转发 GET / HEAD 请求。</p>
</div>
<script>
function go(){
  var v=document.getElementById('u').value.trim();
  if(!v) return;
  v=v.replace(/^https?:\\/*/i,'https://');
  location.href='${base}/gh/'+encodeURI(v);
}
</script>
</body>
</html>`;
}
