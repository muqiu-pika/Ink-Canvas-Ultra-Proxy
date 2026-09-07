/**
 * 请求路径解析 / 白名单校验 / 上游 URL 构造
 * ---------------------------------------------------------------------------
 * 支持四种写法（前两种给 ICU 客户端用，后两种给人手工用）：
 *
 *   A. 前缀直拼（gh-proxy 风格，ICU 的"自动更新代理"设置项就是这种）
 *      /gh/https://github.com/muqiu-pika/Ink-Canvas-Ultra/releases/download/v26.9.2/x.exe
 *      /gh/https://raw.githubusercontent.com/muqiu-pika/Ink-Canvas-Ultra/master/AutomaticUpdateVersionControl.txt
 *      —— 注意：CDN 常把 https:// 的 // 折叠成 / ，所以下面也会把 https:/ 视为同义。
 *
 *   B. 无 scheme 直拼
 *      /gh/github.com/muqiu-pika/Ink-Canvas-Ultra/releases/download/v26.9.2/x.exe
 *
 *   C. 简洁路径（推荐给插件市场这类可以自己改 URL 的场景）
 *      /gh/raw/<owner>/<repo>/<ref>/<文件路径>
 *      /gh/releases/<owner>/<repo>/<tag>/<资产文件名>
 *
 *   D. github.com 的 blob / raw 页面路径（方便直接粘浏览器地址栏的链接）
 *      /gh/https://github.com/muqiu-pika/Ink-Canvas-Ultra-Plugin/blob/main/market/v1/market.json
 */

import {
  REPO_POLICY,
  CACHE_POLICY,
  KNOWN_HOSTS,
} from './config.js';

/**
 * 归一化路径。
 *
 * 兼容各种"传进来的东西到底是什么"的情况（这是踩过坑的地方）：
 *   - 完整 URL：https://host/gh/raw/...
 *   - 纯 pathname：/gh/raw/... 或 raw/...
 *   - catch-all 参数是数组：['raw','muqiu-pika','Ink-Canvas-Ultra','master','x.txt']
 *   - 带 gh/ 前缀（根级 catch-all 会把整串传进来）
 *   - scheme 双斜杠被折叠：https:/github.com/...
 *   - 路径里混入了 %xx 编码
 *
 * 处理顺序：取数组 → 取路径部分（去 query）→ 去前导斜杠 → 剥 gh/ → 截到 GitHub 域名处 → 去 scheme → 解码。
 */
export function normalizePath(rawPath) {
  let p = '';
  if (Array.isArray(rawPath)) {
    p = rawPath.join('/');
  } else if (rawPath && typeof rawPath === 'object') {
    // 某些运行时把 catch-all 参数给成对象，取其中的值再拼
    p = Object.keys(rawPath)
      .map((k) => String(rawPath[k]))
      .join('/');
  } else {
    p = String(rawPath == null ? '' : rawPath);
  }
  p = p.trim();

  // 先解码一次：部分平台会把 catch-all 参数做 URL 编码后传入
  //（例如 gh%2Fraw%2Fmuqiu-pika%2F...），不先还原的话连 gh/ 前缀都剥不掉。
  try {
    p = decodeURIComponent(p);
  } catch (_) {
    // 含非法 % 转义时保持原样
  }

  // 去掉 query 与 hash
  const cut = p.search(/[?#]/);
  if (cut >= 0) p = p.slice(0, cut);

  // 反复归一化，直到不再变化（最多 4 轮）。
  // 之所以要循环：像 /gh/https://github.com/... 这种嵌套形态，
  // 得先剥掉 gh/ 前缀，才会露出里面的 scheme，一轮处理不完。
  for (let i = 0; i < 4; i++) {
    const before = p;
    p = p.replace(/^\/+/, '');

    // 剥掉 gh/ 前缀（根级 catch-all 会把 /gh/xxx 整串传进来）
    if (/^gh(\/|$)/i.test(p)) p = p.length > 2 ? p.slice(3) : '';

    // 处理 scheme：https://、https:/（CDN 折叠了双斜杠）、https: 三种都能吃下
    const m = /^https?:\/*/i.exec(p);
    if (m) {
      const rest = p.slice(m[0].length);
      const slash = rest.indexOf('/');
      const host = (slash >= 0 ? rest.slice(0, slash) : rest).toLowerCase();
      // host 是 GitHub → 连 host 一起留着（后面 parseTarget 要用它判断来源）；
      // 否则说明是我们自己的域名（如 gh.muqiu.eu.org），只保留后面的路径
      const isGithubHost = /(^|\.)(github\.com|githubusercontent\.com)$/.test(host);
      p = isGithubHost ? rest : slash >= 0 ? rest.slice(slash) : '';
    }

    if (p === before) break;
  }

  // 兜底：路径中间才出现 GitHub 域名时，从域名处截断
  const marker = p.search(/(?:^|\/)(?:https?:\/*)?(?:raw\.)?github(?:usercontent)?\.com\//i);
  if (marker > 0) p = p.slice(marker).replace(/^\/+/, '');

  p = p.replace(/^\/+/, '');
  try {
    p = decodeURIComponent(p);
  } catch (_) {
    // 解码失败（含非法 % 转义）就按原样处理，后续白名单匹配会拦掉
  }

  return p.replace(/^\/+/, '').replace(/\/+$/, '');
}

function splitSegments(path) {
  return path
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** 安全拼接：逐段编码，避免文件名里的空格 / 中文 / # 破坏 URL。 */
function joinEncoded(parts) {
  return parts
    .filter((p) => p !== undefined && p !== null && p !== '')
    .map((p) => encodeURIComponent(String(p).replace(/^\/+|\/+$/g, '')).replace(/%2F/gi, '/'))
    .join('/');
}

/**
 * 解析成结构化目标。
 * @returns {{ok:boolean, reason?:string, kind?:'raw'|'release', owner?:string, repo?:string,
 *            ref?:string, filePath?:string, tag?:string, asset?:string, host?:string}}
 */
export function parseTarget(normalizedPath) {
  const seg = splitSegments(normalizedPath);
  if (seg.length === 0) {
    return { ok: false, reason: '缺少代理路径' };
  }

  const head = seg[0].toLowerCase();

  // ---- 带 GitHub 域名的写法（A / B / D） ----
  if (KNOWN_HOSTS.includes(head)) {
    const host = head;
    if (host === 'objects.githubusercontent.com' || host === 'codeload.github.com') {
      return {
        ok: false,
        reason:
          '不支持直接代理该域名（objects/codeload 是 GitHub 内部跳转域名），请使用 github.com 或 raw.githubusercontent.com 的原始链接',
      };
    }
    if (host === 'raw.githubusercontent.com') {
      // raw.githubusercontent.com/<owner>/<repo>/<ref>/<path...>
      if (seg.length < 5) return { ok: false, reason: 'raw 链接缺少文件路径' };
      return {
        ok: true,
        host,
        kind: 'raw',
        owner: seg[1],
        repo: seg[2],
        ref: seg[3],
        filePath: seg.slice(4).join('/'),
      };
    }

    // github.com/<owner>/<repo>/...
    if (seg.length < 4) return { ok: false, reason: 'github.com 链接不完整' };
    const owner = seg[1];
    const repo = seg[2];
    const action = seg[3].toLowerCase();

    if (action === 'releases') {
      const sub = (seg[4] || '').toLowerCase();
      if (sub === 'download') {
        // releases/download/<tag>/<asset>
        if (seg.length < 7) return { ok: false, reason: 'releases 链接缺少 tag 或文件名' };
        return {
          ok: true,
          host,
          kind: 'release',
          owner,
          repo,
          tag: seg[5],
          asset: seg.slice(6).join('/'),
        };
      }
      if (sub === 'latest' && (seg[5] || '').toLowerCase() === 'download') {
        // releases/latest/download/<asset>
        if (seg.length < 7) return { ok: false, reason: 'releases 链接缺少文件名' };
        return {
          ok: true,
          host,
          kind: 'release',
          owner,
          repo,
          tag: 'latest',
          asset: seg.slice(6).join('/'),
        };
      }
      return { ok: false, reason: '仅支持 releases/download 资产直链，不支持 releases 页面或源码包' };
    }

    if (action === 'raw' || action === 'blob') {
      if (seg.length < 6) return { ok: false, reason: 'raw/blob 链接缺少分支或文件路径' };
      return {
        ok: true,
        host,
        kind: 'raw',
        owner,
        repo,
        ref: seg[4],
        filePath: seg.slice(5).join('/'),
      };
    }

    return {
      ok: false,
      reason: `不支持的 GitHub 路径 /${action}（仅放行 releases/download 与 raw/blob 文件内容）`,
    };
  }

  // ---- 简洁写法（C） ----
  if (head === 'raw') {
    if (seg.length < 5) return { ok: false, reason: '简洁路径格式：/gh/raw/<owner>/<repo>/<ref>/<文件路径>' };
    return {
      ok: true,
      host: 'raw.githubusercontent.com',
      kind: 'raw',
      owner: seg[1],
      repo: seg[2],
      ref: seg[3],
      filePath: seg.slice(4).join('/'),
    };
  }
  if (head === 'releases' || head === 'release') {
    if (seg.length < 5) return { ok: false, reason: '简洁路径格式：/gh/releases/<owner>/<repo>/<tag>/<文件名>' };
    return {
      ok: true,
      host: 'github.com',
      kind: 'release',
      owner: seg[1],
      repo: seg[2],
      tag: seg[3],
      asset: seg.slice(4).join('/'),
    };
  }

  return { ok: false, reason: '无法识别的代理路径（不是 GitHub 链接，也不是 /gh/raw 或 /gh/releases 简洁路径）' };
}

function matchRule(rules, value) {
  const v = String(value || '');
  const lv = v.toLowerCase();
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    const target = String(r.value || '').toLowerCase();
    if (r.type === 'exact' && lv === target) return r;
    if (r.type === 'prefix' && lv.indexOf(target) === 0) return r;
    if (r.type === 'suffix' && lv.length >= target.length && lv.lastIndexOf(target) === lv.length - target.length) return r;
    if (r.type === 'regex' && new RegExp(r.value, 'i').test(v)) return r;
  }
  return null;
}

/** 白名单校验：先查仓库，再查路径规则。 */
export function checkPolicy(target) {
  const key = `${target.owner}/${target.repo}`.toLowerCase();
  const policy = REPO_POLICY[key];
  if (!policy) {
    return { ok: false, code: 403, reason: `仓库 ${target.owner}/${target.repo} 不在代理白名单内` };
  }

  if (target.kind === 'raw') {
    // 防御路径穿越：raw 文件路径里不允许出现 ..
    if (/(^|\/)\.\.(\/|$)/.test(target.filePath)) {
      return { ok: false, code: 400, reason: '文件路径不合法（包含 ..）' };
    }
    const refs = (policy.allowedRefs || []).map((r) => r.toLowerCase());
    if (refs.length > 0 && refs.indexOf(String(target.ref).toLowerCase()) < 0) {
      return {
        ok: false,
        code: 403,
        reason: `分支 ${target.ref} 不在白名单内（${policy.display} 仅允许 ${policy.allowedRefs.join(' / ')}）`,
      };
    }
    const rule = matchRule(policy.rawRules, target.filePath);
    if (!rule) {
      return {
        ok: false,
        code: 403,
        reason: `文件 ${target.filePath} 不在白名单内（${policy.display} 仅放行：${policy.rawRules
          .map((r) => r.desc)
          .join('、')}）`,
      };
    }
    return { ok: true, policy, rule };
  }

  // release
  if (/(^|\/)\.\.(\/|$)/.test(target.asset)) {
    return { ok: false, code: 400, reason: '资产文件名不合法（包含 ..）' };
  }
  if (typeof policy.releaseAsset === 'function' && !policy.releaseAsset(target.asset)) {
    return {
      ok: false,
      code: 403,
      reason: `release 资产 ${target.asset} 不在白名单内（${policy.display} 仅放行：${policy.releaseDesc}）`,
    };
  }
  return { ok: true, policy, rule: { desc: policy.releaseDesc } };
}

/** 构造上游 URL。raw 走 raw.githubusercontent.com，release 走 github.com（由它 302 到对象存储）。 */
export function buildUpstreamUrl(target) {
  const owner = encodeURIComponent(target.owner);
  const repo = encodeURIComponent(target.repo);
  if (target.kind === 'raw') {
    const ref = encodeURIComponent(target.ref);
    const file = joinEncoded([target.filePath]);
    return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${file}`;
  }
  const asset = joinEncoded([target.asset]);
  if (String(target.tag).toLowerCase() === 'latest') {
    return `https://github.com/${owner}/${repo}/releases/latest/download/${asset}`;
  }
  return `https://github.com/${owner}/${repo}/releases/download/${encodeURIComponent(target.tag)}/${asset}`;
}

/** 依据文件类型给出 Cache-Control（可用环境变量覆盖，单位秒）。 */
export function cacheControlFor(target, upstreamUrl, env = {}) {
  const url = upstreamUrl || '';
  const path = target.kind === 'raw' ? target.filePath || '' : target.asset || '';

  const readEnv = (name, fallback) => {
    const raw = env && env[name];
    if (raw === undefined || raw === null || raw === '') return fallback;
    return `public, max-age=${String(raw)}`;
  };

  if (target.kind === 'release' || CACHE_POLICY.release.match.test(url)) {
    return readEnv('CACHE_RELEASE', CACHE_POLICY.release.value);
  }
  if (CACHE_POLICY.versionFile.match.test(path)) {
    return readEnv('CACHE_VERSION_FILE', CACHE_POLICY.versionFile.value);
  }
  if (CACHE_POLICY.market.match.test(path)) {
    return readEnv('CACHE_MARKET', CACHE_POLICY.market.value);
  }
  if (CACHE_POLICY.plugin.match.test(path)) {
    return readEnv('CACHE_PLUGIN', CACHE_POLICY.plugin.value);
  }
  return CACHE_POLICY.fallback;
}
