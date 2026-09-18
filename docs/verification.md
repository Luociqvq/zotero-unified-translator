# ZUT 验收记录

本文件记录各版本的验证结论与产物校验值。**仍需人工执行**的项目见 [人工验收清单](acceptance-checklist.md)。

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
| 部署脚本幂等性 | 通过：重复执行结果一致，全流程约 1.4 秒；校验不通过即失败退出，不会发布不一致内容 |

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

### 本轮**未**验证的项目

- **Zotero 客户端实际发现并升级到 1.0.2**：需要真实 Zotero 操作，见人工验收清单 A4。上面所有链路检查（清单可读、产物可取、哈希相符、响应头正确）都只是**必要条件**，最终结论以 A4 为准。
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
- **自动更新链路**：Zotero 实际发现并升级到新版本。
- Docker 镜像构建及容器端到端运行（当前环境无 Docker 命令）。
- macOS / Linux 宿主兼容性。

**已完成**（从原待办移出）：

- ✅ 依赖与第三方许可证审计 —— 2026-09-18 完成，见 [THIRD-PARTY.md](../THIRD-PARTY.md)。

因此当前产物应称为「可安装验收版本」，不能称为「全部功能已在 Zotero 10.0.1 实测通过」。请按 [人工验收清单](acceptance-checklist.md) 逐条跑完后回填本节。
