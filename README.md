# Ink-Canvas-Ultra-Proxy

为 **Ink Canvas Ultra（ICU）** 量身定制的 GitHub 只读反向代理，运行在 EdgeOne Pages 的边缘函数上。

它的目标很单一：**让 ICU 的自动更新、插件市场、插件下载在国内稳定可用**。
它不是通用 GitHub 加速器 —— 除了下面白名单里列出的两个仓库的四类文件，其它一切请求都会被拒绝。

---

## 为什么需要它

ICU 目前联网只有四处，全都指向 GitHub：

| 用途 | 代码位置 | 原始地址 |
| --- | --- | --- |
| 版本检测 | `Helpers/AutoUpdateHelper.cs` | `raw.githubusercontent.com/muqiu-pika/Ink-Canvas-Ultra/master/AutomaticUpdateVersionControl.txt` |
| 安装包下载 | `Helpers/AutoUpdateHelper.cs` | `github.com/muqiu-pika/Ink-Canvas-Ultra/releases/download/vX.Y.Z/Ink.Canvas.Ultra.VX.Y.Z.Setup.exe` |
| 插件市场目录 | `Windows/PluginWorkshopWindow.xaml.cs` | `raw.githubusercontent.com/muqiu-pika/Ink-Canvas-Ultra-Plugin/main/market/v1/market.json` |
| 插件安装包 | 由 market.json 的 `downloadUrl` / `fallbackUrl` 决定 | `raw.githubusercontent.com/muqiu-pika/Ink-Canvas-Ultra-Plugin/main/*.icplugin` |

直连 GitHub 在国内时好时坏，jsDelivr 作为兜底也不稳定；一旦这两条路同时不通，更新检测和插件安装就直接失败。
本代理作为 EdgeOne 边缘节点上的第三条通路：客户端 → 国内就近的 EdgeOne 节点 → 海外节点回源 GitHub，
且 EdgeOne Pages 免费版为**不限流量、不限请求数**（仅边缘函数调用次数有 300 万次/月的免费额度，对本用途而言绰绰有余）。

---

## 能力边界（白名单）

采用**两级校验**：先查仓库，再查路径。任一层不过，直接返回 403。

| 仓库 | 允许分支 | 放行的文件 | 用途 |
| --- | --- | --- | --- |
| `muqiu-pika/Ink-Canvas-Ultra` | `master`、`main` | `AutomaticUpdateVersionControl.txt`（精确匹配） | 自动更新版本检测 |
| 同上 | — | `releases/download/**` 下的全部资产 | 安装包 `Ink.Canvas.Ultra.V*.Setup.exe` |
| `muqiu-pika/Ink-Canvas-Ultra-Plugin` | `main`、`master` | `market/**`（前缀匹配） | 市场目录 `market.json`、更新日志 `changelog.md` |
| 同上 | — | 任意路径下的 `*.icplugin`（后缀匹配） | 插件安装包 |
| 同上 | — | releases 中的 `*.icplugin` | 同上（兼容未来改用 release 分发） |

明确**不放行**的内容（举例）：源码 zip / tarball、`git clone`、仓库其它文件（README、源码、配置）、
白名单外的任何仓库、非 GET/HEAD 的请求、`objects.githubusercontent.com` 内部跳转域名。

> 白名单写在 `edge-functions/_lib/config.js` 的 `REPO_POLICY` 里，新增仓库或文件只要改这一处。

---

## 用法

### URL 写法

设部署后的域名为 `https://<host>`（下面用 `<host>` 代替）。

**1. 前缀直拼（gh-proxy 风格）** —— ICU 的"自动更新代理"设置项就是这种拼接方式：

```
https://<host>/gh/https://github.com/muqiu-pika/Ink-Canvas-Ultra/releases/download/v26.9.4/Ink.Canvas.Ultra.V26.9.4.Setup.exe
https://<host>/gh/https://raw.githubusercontent.com/muqiu-pika/Ink-Canvas-Ultra/master/AutomaticUpdateVersionControl.txt
```

> CDN 常把 `https://` 的双斜杠折叠成单斜杠，代理对 `https://`、`https:/`、`https:` 三种形态都能识别；
> 根级路由也接得住 `https://<host>/https://github.com/...` 这种不带 `/gh/` 的写法，两种入口等价。

**2. 简洁路径** —— 推荐给可以自行改写 URL 的场景（插件市场、market.json）：

```
https://<host>/gh/raw/<owner>/<repo>/<ref>/<文件路径>
https://<host>/gh/releases/<owner>/<repo>/<tag>/<资产文件名>
```

### 四个实际例子

```
# 版本检测（应返回纯文本版本号，如 26.9.4）
https://<host>/gh/raw/muqiu-pika/Ink-Canvas-Ultra/master/AutomaticUpdateVersionControl.txt

# 安装包（v26.9.4 为例）
https://<host>/gh/releases/muqiu-pika/Ink-Canvas-Ultra/v26.9.4/Ink.Canvas.Ultra.V26.9.4.Setup.exe

# 插件市场目录
https://<host>/gh/raw/muqiu-pika/Ink-Canvas-Ultra-Plugin/main/market/v1/market.json

# 插件安装包
https://<host>/gh/raw/muqiu-pika/Ink-Canvas-Ultra-Plugin/main/documenttoimage.icplugin
```

### 自检接口

`https://<host>/health` 返回当前生效的白名单、缓存策略与示例链接（JSON），部署后建议先打开它确认配置。
首页 `https://<host>/` 提供粘贴链接自动生成加速地址的表单。

---

## ICU 客户端接入

### 1. 软件更新 —— 无需改代码

`AutoUpdateHelper` 的下载与检测地址是 `代理前缀 + 完整 GitHub URL` 拼接出来的，
所以只要把**设置 → 自动更新 → 代理**填成（**结尾的斜杠不能少**）：

```
https://<host>/gh/
```

版本检测和安装包下载会同时走代理。填好后可用设置页的"检查代理返回数据"按钮验证 —— 应显示当前最新版本号。

### 2. 插件市场 —— 需要改一行代码

插件市场地址是硬编码数组，不能通过设置项覆盖。在
`Ink Canvas/Windows/PluginWorkshopWindow.xaml.cs` 的 `MarketSources` 中加入代理源（建议放在首位）：

```csharp
private static readonly string[] MarketSources = new[]
{
    "https://<host>/gh/raw/muqiu-pika/Ink-Canvas-Ultra-Plugin/main/market/v1/market.json", // 自建代理
    "https://plugin.muqiu.eu.org/v1/market.json",          // EdgeOne Pages
    "https://cdn.jsdelivr.net/gh/muqiu-pika/Ink-Canvas-Ultra-Plugin@main/market/v1/market.json" // jsDelivr 回退
};
```

### 3. 插件包下载地址 —— 改 market.json

把插件仓库 `market/v1/market.json` 里每个插件的 `downloadUrl` / `fallbackUrl` 换成代理地址：

```json
"downloadUrl": "https://<host>/gh/raw/muqiu-pika/Ink-Canvas-Ultra-Plugin/main/documenttoimage.icplugin",
"fallbackUrl": "https://cdn.jsdelivr.net/gh/muqiu-pika/Ink-Canvas-Ultra-Plugin@main/documenttoimage.icplugin"
```

不改也能用（原来的 GitHub raw / jsDelivr 仍然可达），只是享受不到代理加速。

---

## 缓存策略

| 资源 | Cache-Control | 理由 |
| --- | --- | --- |
| `AutomaticUpdateVersionControl.txt` | `public, max-age=60` | 内容会随发版变化，缓存久了用户检测不到新版本 |
| `market.json` | `public, max-age=60` | 同上，插件发版后必须尽快可见 |
| `*.icplugin` | `public, max-age=60` | **文件名固定、内容会被覆盖重写**。缓存久了会出现"工坊提示更新、下载到的却是旧包、SHA256 校验失败" |
| releases 资产 | `public, max-age=604800, immutable` | tag 唯一、内容不可变，长缓存可让大安装包几乎瞬间开始下载 |
| 其它 | `public, max-age=300` | 兜底 |

> 曾经考虑给 `.icplugin` 也上长缓存，但它的发布方式是"同名覆盖"，一旦缓存就是事故级问题，所以刻意只给 60 秒。
> 这几类文件都很小（几十字节 ~ 几 MB），短缓存带来的回源开销可以忽略。

---

## 环境变量（可选，在 Pages 控制台配置）

| 变量 | 作用 | 默认 |
| --- | --- | --- |
| `PROXY_TOKEN` | 设置后所有请求必须带 `?token=<值>` 或 `X-Proxy-Token` 头，用于临时封禁公开访问 | 不启用 |
| `CACHE_VERSION_FILE` | 版本检测文件的 `max-age`（秒） | 60 |
| `CACHE_MARKET` | 市场 JSON 的 `max-age`（秒） | 60 |
| `CACHE_PLUGIN` | `.icplugin` 的 `max-age`（秒） | 60 |
| `CACHE_RELEASE` | releases 资产的 `max-age`（秒） | 604800 |

---

## 安全设计

- **只放行 GET / HEAD**，其余方法返回 405；`OPTIONS` 仅用于 CORS 预检。
- **两级白名单**：仓库 + 路径规则，任一不匹配直接 403，且错误信息里会写清楚被拒原因，方便排查。
- **不透传请求体**：只转发 `Range`、`If-None-Match`、`If-Modified-Since`、`Accept-Language` 四个请求头。
- **强制 `Accept-Encoding: identity`**：ICU 用的 .NET `HttpClient` 未开启自动解压，若上游返回 gzip 会让版本检测读到乱码。
- **清洗响应头**：剥离 `Set-Cookie`、`Content-Security-Policy`、`Report-To`、`NEL` 等。
- **流式转发**：上游 body 原样传给客户端，不在内存中缓冲（见下）。

---

## 平台限制与适配

EdgeOne Edge Functions 的两条硬约束直接决定了实现方式：

| 限制 | 本项目的应对 |
| --- | --- |
| 运行内存 128 MB | 绝不 `arrayBuffer()` 整个响应；安装包几十 MB，直接把 `Response.body` 流传下去 |
| 单次 CPU 时间 200 ms（不含 I/O） | 不对流做任何逐块加工，只改响应头；回源等待属于 I/O，不计入 |
| 仅支持 JavaScript（ES2023+） | 全部使用 ESM + 标准 Web API，无第三方依赖 |
| 循环上限 10 万次 / 函数 | 只有白名单规则遍历，规模在个位数 |

回源时 `fetch` 使用 `redirect: 'follow'`，因此 `github.com/.../releases/download/...` 的 302
（跳到 `objects.githubusercontent.com`）会自动跟随，客户端拿到的是 200 + 文件流。

### 一个已经踩过的坑：不要依赖 `context.params`

catch-all 路由（`[[default]]`）的参数形态在不同平台 / 版本下并不一致：可能是字符串、数组，也可能被 URL 编码
（斜杠变成 `%2F`）。最初的实现直接读 `context.params.default`，结果所有请求都解析失败，统一报
「400 无法解析的代理路径」。

现在的做法：**一律用 `request.url` 的 pathname 取路径**（`pickPath()`），`params` 只作为兜底；
`normalizePath()` 再兼容数组、对象、URL 编码、`gh/` 前缀、`https:/` 折叠等形态。
一旦仍有解析失败，响应头会回显 `x-proxy-raw`（平台传进来的原始值）与 `x-proxy-path`（归一化后的值），
对比两者即可定位。

---

## 目录结构

```
.
├── edgeone.json                     # EdgeOne Pages 构建配置
├── edge-functions/                  # 边缘函数（按目录结构生成路由）
│   ├── index.js                     # /            首页与用法说明
│   ├── health.js                    # /health      白名单与示例自检
│   ├── [[default]].js               # /*           根级兜底，接住不带 /gh/ 的写法
│   ├── gh/[[default]].js            # /gh/*        主代理入口
│   └── _lib/                        # 共享模块（不导出 Handler，不会被注册成路由）
│       ├── config.js                # 白名单、缓存策略、请求头规则
│       ├── parser.js                # 路径解析、白名单校验、上游 URL 构造
│       ├── proxy.js                 # 回源与响应加工
│       └── home.js                  # 首页 HTML
├── public/                          # 静态资源目录（仅 robots.txt）
└── tools/selftest.mjs               # 本地自检脚本
```

---

## 本地自检

不需要联网即可验证解析与白名单逻辑：

```bash
node tools/selftest.mjs
```

覆盖：四类 URL 写法、被折叠斜杠的兼容、白名单放行/拒绝的各个分支、上游 URL 与缓存头的正确性、
以及 403 / 405 / 400 / 401 等错误分支；另外专门覆盖了线上真实的 pathname 形态、
catch-all 参数为数组 / 被 URL 编码（`%2F`）/ 带 query 等形态。当前 41 条断言全部通过。

---

## 故障排查

| 现象 | 可能原因 |
| --- | --- |
| 403 且提示"仓库不在白名单" | URL 里的 owner/repo 与 `REPO_POLICY` 登记的不一致（比较时大小写不敏感，但拼写需一致） |
| 403 且提示"文件不在白名单" | 请求的文件不属于四类放行资源，例如源码 zip、README |
| 403 且提示"分支不在白名单" | 主程序只能用 `master`/`main`，插件仓库只能用 `main`/`master` |
| 404 | 上游确实没有该文件：检查 tag 与文件名（安装包名含版本号，两个位置都要对） |
| 502 | 边缘节点回源 GitHub 失败或超时，稍后重试 |
| 版本检测拿到乱码 | 上游返回了压缩内容 —— 本项目已强制 `identity` 编码，若仍出现请检查中间是否还有别的代理 |
| 插件一直提示"校验未通过" | 检查是否有中间层给 `.icplugin` 加了长缓存，本代理默认只缓存 60 秒 |
| 首页 404 但 /gh/ 正常 | 根级 catch-all 未在该平台版本生效，统一使用 `/gh/` 前缀即可 |
| 所有路径都报 400 无法解析 | 看响应头 `x-proxy-raw`（平台传入的原始值）与 `x-proxy-path`（归一化后的值），把两者一起反馈；当前实现已从 `request.url` 取路径，理论上不再受 catch-all 参数形态影响 |
| 502 但地址明明正确 | 边缘节点回源 GitHub 失败；可先用浏览器直接访问该 GitHub 地址确认其存在，再重试 |

---

## 许可

GPL-3.0，与 Ink-Canvas-Ultra 保持一致。
