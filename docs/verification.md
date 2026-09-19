# ZUT 验收记录

本文件记录各版本的验证结论与产物校验值。**仍需人工执行**的项目见 [人工验收清单](acceptance-checklist.md)。

---

## 更新链路端到端验收（2026-09-19，针对 v1.0.2 通道）

v1.0.2 的通道部署完成后，补齐了此前一直标记为"待人工"的**自动更新链路**的自动化验证。与前面按版本记录的检查不同，本节检查的是**链路**而非产物，因此单独记。

新增 `scripts/verify-upgrade-path.mjs`：从一个**已安装的 XPI** 出发，顺着它自己内嵌的 `update_url` 走完 Zotero 的更新检查流程。之所以需要它 —— `update_url` 是**烧进已安装包**的，发出之后改不了；`verify-channel.mjs` 只能证明"服务器此刻发的是对的"，证明不了"旧版本客户端还能被带上来"。

### 执行的检查

| 检查 | 结果 |
|---|---|
| GitHub 镜像清单（`raw.githubusercontent.com/.../main/updates.json`） | 通过：已是 **1.0.2**，`update_link` / `update_hash` 与服务端一致 |
| 仓库 main 分支 `updates.json`（API 通道复核） | 通过：与工作区文件逐字段一致，版本 1.0.2 |
| 线上通道（`scripts/verify-channel.mjs`） | **全绿**：清单 200 / `no-cache` / 1.0.2；产物 200、32,575 字节、`application/x-xpinstall`、sha256 相符；证书 Let's Encrypt，剩余 89 天（至 2026-12-17）；与本仓库产物逐字节相同 |
| 升级链路 **1.0.1 → 1.0.2**（`scripts/verify-upgrade-path.mjs`，起点为 Release v1.0.1 的真实产物） | 通过：`update_url` 可达 → 清单提供 1.0.2 → 宿主范围含 10.0.5 → 下载产物 sha256 相符 → 包内版本 1.0.2、ID 一致、版本严格高于 1.0.1 |
| 升级链路 **1.0.2 → 最新**（起点为当前发行产物） | 通过：正确识别"已是最新"，不会产生反复提示同一更新 |
| 发行产物内嵌 `update_url` | 通过：解包 `release/zotero-unified-translator.xpi` 读 `manifest.json`，确认 `update_url` = `https://zut.eieu.cn/updates.json`（无残留占位域名或 raw 地址） |

### 由此确认的两个事实

- **v1.0.1 是最后一个需要手动安装的版本**：1.0.1 的 `update_url` 指向 GitHub raw 镜像，该镜像已被验证会提供 1.0.2，因此 1.0.1 用户能自动升到 1.0.2；升上去之后 `update_url` 即切换到自建通道。1.0.0 及更早仍是占位域名，必须手动装一次。
- **`strict_min_version` / `strict_max_version` 约束的是宿主 Zotero 版本**（`10.0.*`），不是插件版本。这一点此前在文档里没有写明，容易在发版时按插件版本去比对，从而误判"范围不含当前版本"。

### 两条不免除的告警

| 告警 | 说明 |
|---|---|
| GitHub raw 清单 `Cache-Control: max-age=300` | 5 分钟 CDN 缓存。只影响 1.0.1 客户端的**一次性**升级路径；1.0.2 起走自建通道，响应头是 `no-cache` |
| 1.0.2 将 `update_url` 从 GitHub raw 改为自建域名 | 属**预期内迁移**，脚本按"变更须为有意为之"提示。风险点已在部署阶段消除（域名、证书、通道三者均已独立验证） |

### 本轮修正的脚本缺陷

首次跑通前，`verify-upgrade-path.mjs` 自身有两处错误，均已修复 —— 记录下来是因为它们都是**假失败**，会让人误以为链路有问题：

| 缺陷 | 后果 | 修复 |
|---|---|---|
| 只在 `browser_specific_settings.gecko` 下找 `id` / `update_url` | 本项目实际发的是 Zotero 风格 `applications.zotero`，于是被报成"已安装包没有 addon id" | 两个位置都读（`readHostBlock()`） |
| 拿**插件版本**去比 `strict_min/max_version` | 报出"installed 1.0.2 is outside strict_max_version 10.0.\*"的假失败 | 改为比对宿主版本，并新增 `--zotero-version` 参数；未提供时只做范围结构检查并告警提示 |

另外给网络请求加了**瞬时错误重试**（`ECONNRESET` / `ETIMEDOUT` / `EAI_AGAIN` 等，3 次退避）：开发过程中确实遇到过一次 raw 端点连接被重置，而重跑即通。一个偶发失败的检查会让人逐渐忽略它。

### 仍未覆盖（人工项，收敛为一条）

- **在 Zotero 图形界面里实际点「检查更新」并完成升级**：其余环节（清单可读、地址可达、版本更高、范围匹配、哈希相符、包内版本一致）均已自动化验证，但这些都只是**必要条件**。最终结论仍以人工验收清单 A4 为准。
- PDF 阅读器的人工交互与真实 LLM 翻译质量：同 v1.0.1，仍待人工验收。

---

## v1.0.2（2026-09-18）

**本轮变更**：把插件清单的 `update_url` 从 GitHub raw 镜像改为项目自建更新通道 `https://zut.eieu.cn/updates.json`，并在自有服务器上部署该通道（nginx 静态托管 + Let's Encrypt 证书）。插件功能代码与 v1.0.1 逐字节相同；后端代码未改动（仅 `pyproject.toml` 版本号跟随）。

本轮**实际执行**的检查：

| 检查 | 结果 |
|---|---|
| TypeScript 严格类型检查 | 通过 |
| XPI 构建 | 通过，产物 32,575 字节 |
| 插件回归测试 | **13/13 通过**（新增一条断言：`update_url` 的 host 必须是自建通道域名） |
| XPI 内 manifest 校验 | 通过：版本 1.0.2、ID `zotero-unified-translator@zut.dev`、`update_url` = `https://zut.eieu.cn/updates.json` |
| 更新清单一致性校验（`scripts/verify-updates.mjs`） | 通过：清单版本与产物一致，`update_hash` 与产物 sha256 相符 |
| DNS 解析 | 通过：`zut.eieu.cn` 解析到 154.202.118.93，已由 8.8.8.8 / 1.1.1.1 / 223.5.5.5 三处公共解析器确认 |
| TLS 证书签发 | 通过：Let's Encrypt `zut.eieu.cn`（SAN 仅该域名），有效期至 **2026-12-17**，已纳入 `certbot.timer` 自动续期 |
| ACME HTTP-01 挑战路径 | 通过：webroot 测试文件经公网 80 端口取回 200 |
| 公网端到端（从本机发起，非服务器自测） | 通过，见下表 |
| 依赖许可证审计 | 与 v1.0.1 相同，本轮未新增依赖，见 [THIRD-PARTY.md](../THIRD-PARTY.md) |

### 自建更新通道的公网实测（2026-09-18）

| 路径 | 结果 |
|---|---|
| `GET https://zut.eieu.cn/updates.json` | 200，`application/json`，615 字节，`Cache-Control: no-cache, must-revalidate`，`Access-Control-Allow-Origin: *` |
| `GET https://zut.eieu.cn/release/zotero-unified-translator-1.0.2.xpi` | 200，32,575 字节，`application/x-xpinstall`，`Cache-Control: public, max-age=31536000, immutable` |
| 产物 sha256 与清单 `update_hash` | **一致**（`sha256:664836cd98f6a71f93e7b9c139e3be14aad40051dc5732058a8a2c715f9597da`） |
| 公网下载的产物与仓库 `release/` 内文件 | **逐字节相同** |
| `GET http://zut.eieu.cn/` | 301 跳转到 HTTPS（`/.well-known/acme-challenge/` 例外，保留明文以便续期） |
| 站点根目录 | `/xp/www/zut.eieu.cn/`，vhost `/xp/panel/vhost/nginx/zut.eieu.cn.conf` |
| 部署脚本幂等性 | 通过：重复执行结果一致；校验不通过即失败退出。耗时取决于从 GitHub Release 下载产物的速度，那一步是这条链路上最不稳定的一环（见下文缺陷一节） |

### 安装产物

| 项目 | 值 |
|---|---|
| 文件 | `release/zotero-unified-translator.xpi` |
| 大小 | 32,575 字节 |
| SHA-256 | `664836cd98f6a71f93e7b9c139e3be14aad40051dc5732058a8a2c715f9597da` |
| 版本 | 1.0.2 |
| 作者 / ID | Luoci / `zotero-unified-translator@zut.dev` |
| 宿主范围 | 最低 10.0.0，最高声明 10.0.* |

### 更新通道的版本演进

| 版本 | 内嵌 `update_url` | 能否自动更新 |
|---|---|---|
| ≤ 1.0.0 | `https://updates.zut.invalid/updates.json`（IANA 保留域名占位） | **否**，必须手动安装 |
| 1.0.1 | `https://raw.githubusercontent.com/Luociqvq/zotero-unified-translator/main/updates.json` | 能（GitHub 镜像） |
| 1.0.2 起 | `https://zut.eieu.cn/updates.json`（自建通道） | 能 |

服务端维护方式见 [更新通道部署](deployment-updates.md)，发版流程见 [发版与自动更新维护](release.md)。

### 部署脚本的两处缺陷（本轮发现并修复）

首次部署 v1.0.2 时命令超时，事后定位到两个真实缺陷，都已修复：

| 缺陷 | 后果 | 修复 |
|---|---|---|
| 产物下载没有任何超时 | GitHub Release 的下载在某些网络下会**建立连接后不传数据**，脚本无限挂住；实测有一个进程挂了 2 分多钟仍未结束 | 所有网络请求加 `--connect-timeout 15 --max-time`（产物 300 秒），超时即失败退出 |
| 清单先发布、产物后安装 | 上面那次挂起恰好卡在下载环节，于是**线上清单已宣告 1.0.2，而 1.0.2 的安装包还不存在** —— 客户端会看到"有更新"却下载失败，且界面不会解释原因 | 改为全部先落到临时目录、校验通过后发布，**产物在前、清单在后** |

另外新增 `scripts/verify-channel.mjs`：走公网、按客户端的方式跟随清单到底（清单 → `Cache-Control` → 产物 → sha256 → 与本仓库产物比对 → 证书有效期），任一项不符即退出码 1。此前用的是一个临时脚本，它把产物路径写死成 1.0.1，导致一次**假警报**（报了哈希不符，实际是我自己的脚本过期）—— 正式脚本从清单里读取路径，不会再出现这种情况。

### 本轮**未**验证的项目

- **Zotero 客户端实际发现并升级到 1.0.2**：需要真实 Zotero 操作，见人工验收清单 A4。链路侧（清单可读、地址可达、版本更高、宿主范围匹配、哈希相符、包内版本一致）已于 **2026-09-19** 补齐自动化验证，见本文开头「更新链路端到端验收」一节；A4 现在只剩"在图形界面点一下并按预期完成升级"。
- PDF 阅读器的人工交互与真实 LLM 翻译质量：同 v1.0.1，仍待人工验收。

---

## v1.0.1（2026-09-18）

**本轮变更**：仅把插件清单的 `update_url` 从占位域名改为真实更新清单地址，并重建产物。插件功能代码与 v1.0.0 逐字节相同；后端代码未改动（仅 `pyproject.toml` 版本号跟随）。

本轮**实际执行**的检查：

| 检查 | 结果 |
|---|---|
| TypeScript 严格类型检查 | 通过 |
| XPI 构建 | 通过，产物 32,597 字节 |
| 插件回归测试 | **13/13 通过** |
| XPI 内 manifest 校验 | 通过：版本 1.0.1、ID `zotero-unified-translator@zut.dev`、`update_url` 为真实 HTTPS 清单地址 |
| 更新清单一致性校验（`scripts/verify-updates.mjs`） | 通过：清单条目与产物版本一致，`update_hash` 与产物 sha256 相符 |
| 默认翻译接口连通性 | 通过：`https://fanyi.eieu.cn/v1` 无 Key 请求返回 `HTTP 401 {"error":{"message":"A valid Bearer API key is required."}}`，与插件展示的错误串一致 |
| 依赖许可证审计 | 完成，结论与逐项清单见 [THIRD-PARTY.md](../THIRD-PARTY.md) |

### 安装产物

| 项目 | 值 |
|---|---|
| 文件 | `release/zotero-unified-translator.xpi` |
| 大小 | 32,597 字节 |
| SHA-256 | `00e0a8179efe0fb49f49ca8d0144a2424314f5d9edce3fe53579949c1da661e2` |
| 版本 | 1.0.1 |
| 作者 / ID | Luoci / `zotero-unified-translator@zut.dev` |
| 宿主范围 | 最低 10.0.0，最高声明 10.0.* |

### 关于 `update_url`（修正 v1.0.0 记录）

- **v1.0.0 及更早**：清单中的 `update_url` 使用 IANA 保留域名 `.invalid` 作不可解析占位，**不会自动更新**。
- **v1.0.1 起**：改为 `https://raw.githubusercontent.com/Luociqvq/zotero-unified-translator/main/updates.json`，接入自动更新。
- **影响**：已安装 v1.0.0 的用户**不会**收到自动更新提示，需手动安装一次 v1.0.1；此后自动更新才生效。
- 自动更新链路本身（Zotero 端实际发现并升级）属于人工验收项，见清单 A4。
- 该地址已在 **v1.0.2** 中替换为自建通道，见上文 v1.0.2 一节。

---

## v1.0.0（2026-09-08，首验）

> 下表为当时的验证结果，本轮未重跑。第 11 行为当时记录值（9 项），后续版本已扩充到 13 项。
> 其中「安装产物」一节的校验值在 2026-09-18 已按实际提交产物修正（原记录误填了 v0.1.8 的数值）。

### 已通过

| 检查 | 结果 |
|---|---|
| TypeScript 严格类型检查及 XPI 构建 | 通过 |
| 插件回归测试 | 9/9 通过（当时） |
| Python 后端测试 | 7/7 通过，包含真实 pdf2zh-next 配置模型验证 |
| Python 依赖一致性 | pip check 无冲突 |
| npm 依赖审计 | 0 个已报告漏洞（本次安装时结果） |
| PowerShell 5.1 语法解析 | 全部脚本通过 |
| 实际启动 API + Worker | 通过，使用独立测试目录及 18890 端口 |
| 本机 HTTP 上传 → Worker → 下载 | 通过，mock 输出字节与测试 PDF 一致 |
| 停止 API + Worker 进程树 | 通过，测试端口已不再监听 |
| XPI 内 manifest/占位符检查 | 通过，根目录含 manifest.json 和 bootstrap.js，必填 update_url 已生成 |
| 插件图标资源 | 通过，48×48 与 96×96 PNG 均为 RGBA，透明背景已保留 |
| 即时/整篇服务配置隔离 | 通过，插件默认即时服务为 `fanyi.eieu.cn`，整篇服务使用独立 ZUT 后端地址；后端 LLM 配置不复用插件即时配置 |
| 默认翻译接口连通性 | 通过，`https://fanyi.eieu.cn/` 与 `/health` 返回服务状态；未提供 Key 的翻译请求按预期返回 401 |
| 真实 Zotero 10.0.1 隔离启动 | 通过，当时 XPI 被识别为兼容、appDisabled=false；直接放入 profile extensions 目录时宿主默认 userDisabled=true |
| 插件 startup | 通过，XPI 在模拟宿主中确认 Reader、菜单和设置注册；真实宿主的兼容性判定已通过 |

插件回归在 Node 模拟宿主中加载实际 XPI 的 bootstrap 与脚本，并检查 Reader、菜单和设置注册；**它不是 Zotero GUI 测试**。其余回归验证现代凭据接口、PDF 二进制读写、保留最新评论与去重、下载同源校验、XUL 标签。

后端测试的引擎配置使用真实已安装的 pdf2zh-next 2.9.0，但翻译事件用模拟流替代。没有调用真实付费模型。测试期间第三方 PyMuPDF 模块产生 5 条弃用警告，不影响测试通过。

### 安装产物（2026-09-18 修正）

| 项目 | 值 |
|---|---|
| 文件 | `release/zotero-unified-translator.xpi`（对应 tag `v1.0.0`） |
| 大小 | 32,576 字节 |
| SHA-256 | `556f0cf1792a465cb5e8ce171168b2e7e626adb8facf2d3501a76bd3e3f2bdcd` |
| 版本 | 1.0.0 |

> 原记录填写的 29,456 字节 / `B9CC8BEE…` 实为 v0.1.8 产物的数值，已修正。
> 上述 SHA-256 与 GitHub Release `v1.0.0` 资产报告的 digest 一致，说明 Release 附件与本地产物逐字节相同。

### 历史根因记录

旧包被 Zotero 10.0.1 拒绝的根因已复现并定位：本机 `Extension.sys.mjs` 会把缺少 `applications.zotero.update_url` 的扩展判为无效。v1.0.0 已补齐该必填字段（当时填的是 `.invalid` 占位地址，v1.0.1 换成真实清单地址）。

---

## 尚未通过实机验收的项目

以下项目**自动化无法覆盖**，需要在真实 Zotero + 真实 Key 下人工执行。逐条步骤与判定标准见 **[人工验收清单](acceptance-checklist.md)**：

- 通过 Zotero 图形界面手动执行「从文件安装」、禁用、启用、重启及设置控件操作。
- 在真实 PDF Reader 中划词、复制、保存注释和导入译文；弹窗停靠位置与自动收起行为。
- 真实模型 Key 下的译文质量、联网字体/布局资源、复杂 PDF 的版式还原。
- `fanyi.eieu.cn` 的真实译文返回（当前只验证了接口连通性与鉴权行为）。
- 整篇 PDF 链路：真实后端、真实 LLM、输出附件导入与去重。
- **自动更新链路的人工确认**：在 Zotero「工具 → 插件」里点「检查更新」并按预期完成升级。链路本身已于 2026-09-19 自动化验证（见本文开头），此处只差人工点击确认。
- Docker 镜像构建及容器端到端运行（当前环境无 Docker 命令）。
- macOS / Linux 宿主兼容性。

**已完成**（从原待办移出）：

- ✅ 依赖与第三方许可证审计 —— 2026-09-18 完成，见 [THIRD-PARTY.md](../THIRD-PARTY.md)。

因此当前产物应称为「可安装验收版本」，不能称为「全部功能已在 Zotero 10.0.1 实测通过」。请按 [人工验收清单](acceptance-checklist.md) 逐条跑完后回填本节。
