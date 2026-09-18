# Zotero Unified Translator：Zotero 10 实施方案

版本：2.2；对应实现：1.0.2；更新：2026-09-18。
目标宿主为用户使用的 Zotero 10.0.1。本文取代原来的 Zotero 7 开发基线；区分已实现接口与发行验收，不能将方案目标视作已通过实机测试。

## 1. 交付范围

当前交付 XPI、插件源码、独立 ZUT PDF 后端、Windows 操作脚本、Docker 配置、自动化测试及中文 README。后端可远程 Docker 部署，也可选择在用户本机运行。
第一阶段聚焦两条链路：

1. PDF 选区 → 翻译服务 → 译文显示 → 复制/注释。
2. Zotero PDF → 后端任务 → PDF 引擎 → 下载 → 新附件。

默认即时翻译服务为 `https://fanyi.eieu.cn/v1` 的 `HY-MT1.5-1.8B`，使用 OpenAI Chat Completions 兼容协议并要求 Bearer API Key。Google 免 Key 接口仍作为备用尽力服务。整篇翻译使用独立的 ZUT PDF 后端，插件只连接其 `/api/v1` 任务 API；后端可部署在远程 Docker 或用户本机，使用独立的 ZUT_LLM_* 配置，不与即时翻译配置混用。当前默认引擎为服务器端 pdf2zh-next 2.9.0，后端 Python 固定 3.12 系列。

## 2. 官方接口依据

开发流程以 Zotero 官方资料为准，不将 Codex 插件规范或浏览器扩展安装流程用于 Zotero。

| 环节 | 实现接口/规则 |
|---|---|
| 安装识别 | XPI 根目录 manifest.json，applications.zotero、固定插件 ID、必填 update_url |
| 生命周期 | bootstrap.js 的 startup/shutdown 和窗口钩子 |
| Reader 选区 | Zotero.Reader.registerEventListener('renderTextSelectionPopup', ...) |
| Reader 页面右键 | Zotero.Reader.registerEventListener('createViewContextMenu' / 'createSelectorContextMenu', ...) |
| 原生弹窗 | 同步调用事件 append，再异步更新文本 |
| 条目菜单 | Zotero.MenuManager.registerMenu |
| 设置 | Zotero.PreferencePanes.register + XHTML 片段 |
| 凭据 | Services.logins.findLogins（三参数）、addLoginAsync、modifyLogin |
| 偏好 | Zotero.Prefs 使用全局键 extensions.zut.config，schemaVersion=3；旧的未修改 Google/OpenAI 默认值迁移到 HY 服务 |
| 二进制文件 | IOUtils.read/write，禁止通过文本解码读取 PDF |
| 注释 | Zotero.Annotations.toJSON/saveFromJSON，保留最新已有评论 |
| 附件 | Zotero.Attachments.importFromFile，创建新附件 |

出处：
[官方基础开发文档](https://www.zotero.org/support/dev/zotero_7_for_developers)、
[Zotero 10 开发说明](https://www.zotero.org/support/dev/zotero_10_for_developers)、
[10.0.1 源码](https://github.com/zotero/zotero/tree/10.0.1)。
兼容范围声明为 10.0.0–10.0.*，实机验收目标仅 10.0.1。升级到新的 Zotero 次版本后应重新测试并调整上限。

## 3. 插件设计

bootstrap 为打包脚本提供宿主对象、网络、加密、二进制文件和定时器接口。主入口注册 Reader、菜单及设置页；卸载/禁用清理注册、弹窗与监听。

即时翻译服务按接口注册。输入移除软连字符和多余换行，按服务字符上限校验。网络请求有超时，错误显示在弹窗中，可手动重试。译文通过 textContent 显示，避免将模型输出当成 HTML。

设置页提供“测试即时翻译”按钮，使用当前表单中的地址、模型和 Key 发送固定短句；它不保存表单，也不测试整篇 PDF 后端。OpenAI 兼容错误支持读取标准嵌套 `error.message`，便于识别 401、模型不存在等问题。

注释保存读取数据库中的最新评论；用户已有内容不覆盖。通过译文标识判断重复，拒绝只读对象。

普通设置与密钥分开存储。读取旧错误命名空间作为迁移兼容，写入正确的全局偏好键。密钥框保存后清空，但不会因此删除已存密钥。

整篇客户端读取文件、计算 SHA-256，检查引擎元数据，上传并轮询任务。下载地址必须同源。导入完成后删除临时文件。父条目下用包含文件哈希、语言、引擎和输出模式的标题去重。

当前客户端没有完整任务中心。用户需要保持 Zotero 打开直到完成导入；重启自动恢复下载、插件取消按钮及批量任务是后续任务。

## 4. 后端执行模型

Flask application factory + Waitress API；独立 Worker；SQLite 持久化任务。该服务就是整篇 PDF 的独立后端，可由用户部署到远程 Docker，也可在本机运行；插件不需要知道其内部 Python 运行位置。
只部署一个 Worker。多 Worker 下的重启恢复需要租约机制，当前不支持。

~~~text
queued → processing → completed
   └────────┴──────→ failed / cancelled
~~~

API 前缀 /api/v1，提供 health、tasks 创建/查询/列表、cancel 和 file 下载。上传使用 multipart。默认文件上限 100 MB、200 页，目标语言由插件设置提供。

幂等键复用不同内容返回 409；活动/已完成任务可复用。失败或已取消任务允许以相同客户端键重新提交；历史记录保留。
并发提交相同新任务的竞争控制仍需增强，当前用户一次操作一篇，不能视作高并发服务。

pdf2zh-next 通过 Python SettingsModel/OpenAISettings 和 do_translate_async_stream 适配，读取进度事件及输出路径。它是后端内部的 PDF 处理/排版引擎，不是 Zotero 插件，也不是即时翻译接口；重量级模块延迟至 Worker 执行时导入。health 只读取包元数据和配置存在性，不推断真实模型可用。

mock 仅用于 API 测试，必须显式启用，不产生译文。旧 CLI 适配器不作为当前 UI 的支持引擎。

## 5. 安装、运行和发布

XPI 为安装格式，不另造自动改写 Zotero 配置目录的 EXE。用户从 Zotero 插件管理器选择文件安装；使用主设置中的插件页面配置服务。

构建采用本地脚本：
TypeScript 检查 → esbuild IIFE → 资源变量替换/Fluent 前缀 → XPI。
构建不需要 GitHub 仓库。Zotero 10.0.1 会将缺少 applications.zotero.update_url 的插件判为无效，因此本地包使用 IANA 保留的 `.invalid` 域名作为明确不可解析的占位地址；公开发行时必须用真实 HTTPS 更新清单替换。构建脚本支持用 ZUT_UPDATE_URL 环境变量覆盖默认值，正式签发流程留待实际发布时执行。

Windows 脚本负责：

- setup-backend.ps1：检查 Python、虚拟环境、安装及验证依赖，非零退出即失败。
- start-backend.ps1：隐藏输入口令、只读取 ZUT_ 配置、统一数据路径、检查端口、启动 API/Worker、记录进程身份。
- stop-backend.ps1：校验进程路径及启动时间，再停止对应进程树。
- package-plugin.ps1：构建及测试成功后复制 XPI 至 release。

服务不自动随系统启动。已有 .env 可作为高级配置，用户负责其保管；默认交互不写密钥文件。

Docker 为 API/Worker 两容器，共享任务卷，默认仅发布本机端口。构建上下文排除 .env、虚拟环境和任务文件。该路径需 Docker 实机验收。

## 6. 数据与隐私

即时服务接收选区文本，整篇后端接收 PDF，LLM 接收引擎抽取的翻译文本。
后端 LLM Key 与插件即时 Key 独立。第三方引擎可能创建翻译缓存、字体缓存和日志，应按其实际版本检查。

任务创建后默认 7 天具备清理资格；清理命令仅处理 completed/failed/cancelled。当前需手动或由管理员单独调度，不承诺自动删除。已导入 Zotero 的附件独立于后端存储。

远程实例按单用户设计。公开共享前必须另做身份认证、数据隔离、配额和租约队列；不能直接将当前单令牌服务当作多用户产品。

## 7. 测试和发行门槛

自动化覆盖：

- XPI 启动时注册 Reader、菜单和设置。
- 新版凭据接口及密钥更新。
- PDF 二进制字节读写保真。
- 保存注释不覆盖用户评论。
- 阻止向不同来源下载地址发送 Token。
- API 鉴权、PDF 校验、任务流转、去重和取消。
- 失败任务重提与幂等冲突。
- 已安装 PDF 引擎的真实配置模型和输出路径契约。

仍需实际验收：

1. 通过 Zotero 图形界面的“从文件安装”完成安装、禁用、启用和重启人工验收；隔离配置档案中的清单识别与兼容性判定已通过，GUI 全流程仍需人工验收。
2. 设置页中文标签、按钮、密钥保存/读取。
3. PDF 内选区弹窗、复制及保存注释。
4. 真实 LLM 翻译短 PDF 并自动导入。
5. Windows 停启、任务重试；Docker 构建。
6. 复杂 PDF 版式抽查、依赖许可与发行文件审核。

测试记录见 docs/verification.md；未完成的实机项目不能标记通过。

## 8. 后续版本

批量翻译、任务历史/取消 UI、恢复下载、SSE、多引擎对比、连续逐句翻译、元数据翻译、OCR、术语表、快捷键与跨平台实测分阶段实施。
原始方案中的“排版完美保留”和“零配置一定可用”不是可验证承诺，不作为发行标准。
