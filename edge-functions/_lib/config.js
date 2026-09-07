/**
 * 白名单与策略配置
 * ---------------------------------------------------------------------------
 * 本代理是「白名单 + 路径级授权」的只读反向代理，不是通用 GitHub 加速器：
 *   1. 仓库白名单：只有下面 REPO_POLICY 里显式登记的仓库会被代理，其余一律 403。
 *   2. 路径白名单：即使仓库命中，仍然要再过一次 raw / release 的规则匹配，
 *      未登记的路径（例如源码 zip、git clone、任意分支文件）一律 403。
 *   3. 只放行 GET / HEAD：不转发任何写操作，也不接受请求体。
 *
 * 之所以做这么严：代理一旦开放成通用用途，就会被拿去刷流量 / 拉取任意仓库，
 * 既违背"只服务 ICU 自身更新"的初衷，也会把免费额度（每月 300 万次函数请求）打爆。
 */

export const PROXY_NAME = 'ICU GitHub Proxy';
export const PROXY_VERSION = '1.0.0';

/** 回源时使用的 UA。GitHub 对空 UA / 极简 UA 的响应不稳定，统一给一个正常的 UA。 */
export const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** 回源超时（毫秒）。仅对建立连接阶段兜底，流式传输不受影响。 */
export const UPSTREAM_TIMEOUT_MS = 15000;

/**
 * 仓库策略表。key 必须小写，比较时会把 owner/repo 统一小写。
 *
 * rawRules     —— 命中 raw.githubusercontent.com 的路径规则（数组，命中任一即放行）
 * releaseAsset —— 命中 releases 资产时调用的判断函数，返回 true 放行
 *
 * 规则对象：{ type: 'exact' | 'prefix' | 'suffix' | 'regex', value, desc }
 */
export const REPO_POLICY = {
  // 1) 主程序仓库：只放行「版本检测文件」+「releases 资产」
  'muqiu-pika/ink-canvas-ultra': {
    display: 'Ink-Canvas-Ultra',
    homepage: 'https://github.com/muqiu-pika/Ink-Canvas-Ultra',
    // 版本检测走的是分支上的固定文件，允许 master / main 两个 ref，避免以后换默认分支失效
    allowedRefs: ['master', 'main'],
    rawRules: [
      {
        type: 'exact',
        value: 'AutomaticUpdateVersionControl.txt',
        desc: '自动更新版本检测文件',
      },
    ],
    // 安装包（Ink.Canvas.Ultra.V26.9.2.Setup.exe）等全部 releases 资产
    releaseAsset: () => true,
    releaseDesc: 'releases 全部资产（安装包等）',
  },

  // 2) 插件仓库：只放行「市场目录」+「.icplugin 安装包」
  'muqiu-pika/ink-canvas-ultra-plugin': {
    display: 'Ink-Canvas-Ultra-Plugin',
    homepage: 'https://github.com/muqiu-pika/Ink-Canvas-Ultra-Plugin',
    allowedRefs: ['main', 'master'],
    rawRules: [
      {
        type: 'prefix',
        value: 'market/',
        desc: '插件市场目录（market.json / changelog.md 等）',
      },
      {
        type: 'suffix',
        value: '.icplugin',
        desc: '插件安装包',
      },
    ],
    // 仓库里的 .icplugin 本质上和 raw 的 .icplugin 是同一类东西，一并放行；
    // 其它 releases 资产（如源码包）不放行。
    releaseAsset: (asset) => /\.icplugin$/i.test(asset || ''),
    releaseDesc: 'releases 中的 .icplugin 安装包',
  },
};

/**
 * 缓存策略（Cache-Control 响应头）。
 *
 * 注意：这里刻意对「会被就地更新的文件」使用很短的缓存：
 *   - AutomaticUpdateVersionControl.txt：内容会随发版变化，缓存久了用户检测不到新版本；
 *   - market.json / *.icplugin：文件名固定、内容会随插件发版被覆盖重写，
 *     缓存久了会出现「插件工坊提示更新，但下载到的还是旧包，SHA256 校验失败」。
 * 反过来，releases 资产是「tag 唯一 + 内容不可变」的，可以放心长缓存，
 * 这也是省回源、让大安装包秒开的关键。
 */
export const CACHE_POLICY = {
  versionFile: { match: /AutomaticUpdateVersionControl\.txt$/i, value: 'public, max-age=60' },
  market: { match: /(^|\/)market\/.*\.json$/i, value: 'public, max-age=60' },
  plugin: { match: /\.icplugin$/i, value: 'public, max-age=60' },
  release: { match: /(^|\/)releases\/(download|latest\/download)\//i, value: 'public, max-age=604800, immutable' },
  fallback: 'public, max-age=300',
};

/** 允许透传给上游的请求头（其余一律丢弃，避免把客户端痕迹带给 GitHub）。 */
export const FORWARD_REQUEST_HEADERS = [
  'range',
  'if-none-match',
  'if-modified-since',
  'accept-language',
];

/** 必须从上游响应里删掉的头（安全 / 缓存冲突 / 无用）。 */
export const STRIP_RESPONSE_HEADERS = [
  'content-security-policy',
  'content-security-policy-report-only',
  'set-cookie',
  'clear-site-data',
  'x-github-request-id',
  'report-to',
  'nel',
];

/** 会参与回源的 GitHub 域名（用于解析形如 /gh/https://host/... 的请求）。 */
export const KNOWN_HOSTS = [
  'raw.githubusercontent.com',
  'github.com',
  'www.github.com',
  'objects.githubusercontent.com',
  'codeload.github.com',
];
