# Zotero Unified Translator（ZUT）

面向 Zotero 10.0.1 的 PDF 翻译插件，当前版本 0.1.8。作者：Luoci。提供划词翻译、译文复制/保存为注释，以及通过独立后端生成双语或仅译文 PDF。

已生成可供安装验收的 XPI，并在本机真实 Zotero 10.0.1 的隔离配置档案中通过清单识别和兼容性判定；插件启动注册另有自动化回归覆盖。PDF Reader 交互及真实 LLM 翻译仍需人工验收，不能把启动成功理解为所有功能均已实机验证。

## 先安装插件，只需这几步

1. 打开 Zotero 10.0.1。
2. 点击「工具 → 插件」，再点齿轮 →「从文件安装插件」。
3. 选择下列 XPI 文件，确认安装。若提示重启，按提示重启。
4. 打开 Zotero「编辑 → 设置」，在左侧找到「Zotero Unified Translator」。
5. 打开一个有文本层的 PDF，选中一句话，查看选区弹窗里的翻译。

~~~text
D:\Code管理\zotero插件设计\release\zotero-unified-translator.xpi
~~~

XPI 就是 Zotero 的插件安装包，不需要单独的 EXE 安装程序。只使用划词翻译时，不需要 Python、Docker 或后端。

插件包内置透明背景的 48×48 与 96×96 图标，安装后会显示在 Zotero 的插件管理器中。

此前版本的不兼容提示并不是 Zotero 版本过旧，而是插件包缺少 Zotero 10.0.1 实际校验所要求的 `applications.zotero.update_url`。当前 0.1.8 已补齐该字段，并声明最低 Zotero 10.0.0、最高 10.0.*；这不是对 10.1 或未来版本的兼容承诺。

升级时可从文件安装同一插件的新包，通常不必卸载。如果仍不兼容，先核对选中的文件确实来自 release 文件夹，再核对「帮助 → 关于 Zotero」的版本。不要关闭 Zotero 的兼容性检查。卸载插件不会删除已保存的 PDF 和注释；重新安装后应检查设置是否保留。

## 划词翻译怎么用

默认服务是 `https://fanyi.eieu.cn` 提供的 HY-MT1.5-1.8B 翻译接口。插件会按 OpenAI 兼容协议调用 `https://fanyi.eieu.cn/v1/chat/completions`，模型默认填写 `HY-MT1.5-1.8B`。接口根地址和健康检查已确认可访问；翻译请求必须带 Bearer API Key，因此首次使用前需要在设置页填入 Key。

接口首页返回的规范模型标识是 `HY-MT1.5-1.8B`。如果你的账号实际只接受 `hy-1.8b` 这个别名，可在设置页把「模型名称」改成该别名。

打开设置页后，默认已经选中「HY-MT1.5-1.8B 翻译接口（OpenAI 兼容）」；填好 API Key 后点击「保存设置」，再点击「测试即时翻译」确认接口返回译文。选中文字后会自动发送到该服务并显示译文，可以「复制」或「保存到注释」。

保存会创建选区注释，或向已有、可编辑注释追加译文，并保留已有评论。当前仅接入 PDF Reader，不自动识别扫描图中的文字。

如需改用 Google，选择 Google Translate；如需改用其他兼容服务，保留「HY-MT1.5-1.8B 翻译接口（OpenAI 兼容）」并修改以下字段：

| 字段 | 填写方法 |
|---|---|
| 地址 | 兼容 Chat Completions 的基础地址；本接口填写 `https://fanyi.eieu.cn/v1` |
| 模型名称 | 本接口填写 `HY-MT1.5-1.8B`；其他服务填写其实际模型 ID |
| API Key | 填自己的密钥，然后点击「保存设置」 |
| 默认目标语言 | 简体中文、繁体中文、英语等 |

点击保存后，当前设置页会保留密钥输入框内容，避免误以为保存失败；重新打开设置页时不会回显密钥。留空再次保存会保留原密钥，「清除」才会删除密钥。密钥保存在 Zotero 的登录凭据管理器中，不写入普通偏好设置，也不等于已经配置了整篇翻译后端。

Google 单次选区上限为 4500 字符，兼容 LLM 为 12000 字符；超长文本请缩短选区或使用整篇翻译。

## 整篇 PDF 翻译：独立 ZUT 后端

整篇翻译使用项目中的独立 `server/` 服务，不是 `https://fanyi.eieu.cn` 的即时翻译接口。插件只负责上传 PDF、轮询任务、下载结果和导入 Zotero；PDF 解析、排版和整篇翻译全部在 ZUT 后端完成。

ZUT 后端可以部署在远程服务器 Docker，也可以由用户在本机运行。用户使用远程服务器时不需要在自己的电脑安装 Python。后端内部当前默认使用 `pdf2zh-next 2.9.0` 作为 PDF 处理/排版引擎；它是 Python 服务器依赖，不是 Zotero 插件，也不等于即时翻译服务。后端的 LLM 地址、模型和 Key 通过独立的 `ZUT_LLM_*` 配置管理，与插件划词翻译配置分开。

### 推荐：服务器 Docker 部署

在准备部署的服务器上复制项目文件，创建自己的 `.env`（不要把真实密钥提交到仓库）：

~~~bash
cp .env.example .env
~~~

至少填写：

~~~dotenv
ZUT_AUTH_TOKEN=设置一个较长的后端访问口令
ZUT_LLM_ENDPOINT=https://你的整篇翻译模型服务/v1
ZUT_LLM_MODEL=你的整篇翻译模型
ZUT_LLM_API_KEY=你的整篇翻译模型密钥
~~~

这里的 `ZUT_LLM_*` 是整篇 PDF 后端自己的配置，可以使用任何兼容服务；它不会自动读取或复用插件中保存的即时翻译 Key。若你希望整篇后端也调用 `fanyi.eieu.cn`，可以在这个服务器的 `.env` 中单独填写它，但这不是插件的即时翻译配置。

启动 API 和 Worker：

~~~bash
docker compose up -d --build
docker compose logs -f
~~~

默认 API 只绑定服务器本机 `127.0.0.1:8890`。远程使用时，推荐用 Nginx/Caddy 将 HTTPS 域名反向代理到该端口，并配置上传大小限制和访问认证；不要直接把未加密的后端暴露到公网。服务器上的 ZUT 地址必须能访问 `/api/v1/health` 和 `/api/v1/tasks`。

### 连接远程后端

在 Zotero 设置页的「整篇 PDF 翻译」区域填写：

| 设置 | 内容 |
|---|---|
| 整篇翻译后端地址 | 你的 ZUT 后端 HTTPS 地址，例如 `https://pdf.example.com` |
| 后端 Bearer Token | 服务器 `.env` 中的 `ZUT_AUTH_TOKEN` |
| PDF 引擎 | `pdf2zh-next 2.9.0` |
| 输出模式 | 双语 PDF 或仅译文 PDF |

点击「保存设置」，再点「检查两个接口」。这里不能填写 `https://fanyi.eieu.cn`，除非该地址另外提供了 ZUT 的 PDF 任务 API；目前它只是文本翻译接口。

「检查两个接口」会并行执行一次即时翻译请求和一次 ZUT 后端健康检查，并分别报告即时翻译接口、整篇 PDF 接口及整体结果；即时翻译请求会验证 API Key 和模型是否真的可用，整篇检查会验证后端状态及所选 PDF 引擎。每项检查最多等待 15 秒，超时的一项不会阻塞另一项结果。插件的「测试即时翻译」仍可单独测试划词接口。

### 可选：本机部署后端

只有不使用远程 Docker 后端时，才需要在本机安装 Python 3.12（64 位）并执行：

#### 1. 安装后端依赖（首次执行）

在项目根目录打开 PowerShell，执行：

~~~powershell
Set-Location 'D:\Code管理\zotero插件设计'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-backend.ps1
~~~

脚本检查 Python 版本，创建 server/.venv，安装依赖并检查依赖一致性。失败会停止并显示错误，不会把失败当成安装完成。依赖较多，首次需要等待下载。本次交付已在当前机器创建并验证该虚拟环境。

#### 2. 启动后端

~~~powershell
Set-Location 'D:\Code管理\zotero插件设计'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-backend.ps1
~~~

按提示输入：

- Backend token：自定一个较长的访问口令，之后在 Zotero 设置中填同一个值。
- LLM API Key：模型服务商提供的密钥。

启动脚本会要求输入 Backend token 和整篇翻译后端的 LLM API Key。后端默认示例为 `https://api.openai.com/v1` 和 `gpt-4o-mini`；如果你的部署使用其他兼容服务，在启动前设置：

~~~powershell
$env:ZUT_LLM_ENDPOINT = '你的服务商基础地址'
$env:ZUT_LLM_MODEL = '你的模型名称'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-backend.ps1
~~~

脚本默认通过隐藏输入读取密钥，仅传给本次进程；不自动将密钥写入文件。高级用户也可通过进程环境变量提供配置，或用 -EnvFile 指定自己管理的配置文件。根目录已有 .env 时脚本会读取其中的 ZUT_ 配置，文件中的值优先。

脚本启动 API 和 Worker，检查进程及 API 是否就绪。服务运行在后台，不随当前命令结束而退出；不配置开机自启。端口占用会明确报错。

日志位于 data/zut-api.log、data/zut-api.log.error、data/zut-worker.log 和 data/zut-worker.log.error。不要公开包含第三方响应或论文信息的原始日志。

#### 3. 连接 Zotero（本机后端时）

在 ZUT 设置页填写：

| 设置 | 内容 |
|---|---|
| 后端地址 | http://127.0.0.1:8890 |
| 后端 Bearer Token | 启动时输入的 Backend token |
| PDF 引擎 | pdf2zh-next 2.9.0 |
| 输出模式 | 双语 PDF 或仅译文 PDF |

点击「保存设置」，再点「检查两个接口」。

「检查两个接口」会同时检查即时翻译请求和整篇 PDF 后端：前者需要有效 API Key，后者确认健康状态、所选引擎和后端配置。它仍不会验证完整 PDF 翻译质量、字体资源或最终输出版式；实际翻译才能完成全链路验证。本地健康接口不要求 Token，Token 填错会在上传时返回 401。

#### 4. 翻译一篇 PDF

1. 先选择一篇较短、可选中文字的 PDF。
2. 可以在文献列表中选择一个父条目或一个 PDF 附件，右键打开「ZUT」子菜单，再选择「ZUT: 翻译 PDF」；也可以直接在 Zotero PDF 阅读器页面（或选中文字后）右键「翻译整篇 PDF」。
3. 等待上传和翻译进度；完成后会自动添加一个新 PDF 附件。
4. 打开译文，检查文字、公式和版式。

对有父条目的 PDF，译文加入同一个父条目；独立 PDF 的译文也作为独立附件导入。原始文件不会被替换。

译文标题包含原文件名、语言、输出模式、引擎和源文件哈希片段，避免同名但内容不同的 PDF 被误判。父条目下相同译文标题会阻止重复导入；独立附件不提供这项客户端去重。

当前一次提交一篇。目标语言沿用设置中的「默认目标语言」。保持 Zotero 打开直到下载完成；尚无插件任务历史页或重启后自动接续下载。后端 API 提供任务查询、下载和取消接口。

#### 5. 停止后端

~~~powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\stop-backend.ps1
~~~

停止脚本核对启动记录中的进程身份，再结束 API、Worker 及其子进程。使用自定义数据目录时传 -DataDir。停止正在翻译的 Worker 会中断任务，下次启动会将未完成任务标记失败，可重新提交。

## 常见问题

| 现象 | 处理 |
|---|---|
| 无法安装/提示不兼容 | 确认安装的是 0.1.8 新包；关闭仍打开的旧安装对话框后，从 release 目录重新选择 XPI |
| 没有设置入口 | 在 Zotero 主设置左侧找插件名；尝试重启，检查插件是否启用 |
| 划词翻译失败 | 检查接口地址、模型名和 API Key；点击「测试即时翻译」查看具体错误 |
| 提示 `valid Bearer API key is required` | 接口已连通，但没有填入有效 API Key；在设置页输入后保存 |
| 双接口检查失败 | 分别查看即时翻译接口和整篇 PDF 接口的错误；整篇后端还需核对端口及 data 日志 |
| 上传返回 401 | 插件 Token 与后端启动口令必须一致 |
| 一直排队 | 确认 Worker 未退出；API 在线不代表 Worker 在线 |
| ENGINE_UNAVAILABLE | 检查依赖版本、后端 Key、地址和模型配置 |
| ENGINE_FAILED | 检查模型权限、网络、字体/模型资源及 PDF；用短文献重试 |
| 输出与原文相同 | 确认没有使用 mock；mock 只复制文件，不翻译 |
| 双栏、公式或表格不理想 | 引擎不能保证所有 PDF 完美保留版式；应检查实际结果 |

## Docker 与远程部署补充

完整 Docker 部署流程见上面的「推荐：服务器 Docker 部署」和[部署说明](docs/deployment.md)。API 与 Worker 共享 `zut-data` 卷，默认端口只映射到服务器本机 `127.0.0.1:8890`；远程访问应使用 HTTPS 反向代理、认证和上传限制。

当前后端按单个可信用户设计，没有多用户数据隔离、配额或管理员页面，不能直接作为开放共享翻译服务。

## 数据、隐私和清理

选区文本会发给所选翻译服务；整篇 PDF 发往所配置后端，PDF 引擎再向 LLM 发送翻译所需的文本。LLM 服务可能收费，按自己的账号计费。

插件凭据通过 Zotero 登录管理器保存。后端 Key 由环境变量提供；本地 .env 属于用户自行管理的明文配置，并非加密存储。没有自动同步密钥或遥测功能。

任务源文件和输出保存在 ZUT_DATA_DIR。默认从任务创建起 7 天后具备清理资格，失败任务文件也保留至清理。当前不会自动定时清理；停止翻译后按需执行：

~~~powershell
$env:PYTHONPATH = "$PWD\server"
$env:ZUT_DATA_DIR = "$PWD\data"
server\.venv\Scripts\python.exe -m zut_server.cleanup
~~~

清理会删除已过期终态任务及其后端文件，无法通过后端恢复；已经导入 Zotero 的附件不会删除。引擎字体和翻译缓存可能另存于用户目录，不由该命令清理。

## 开发和验证

插件：

~~~powershell
Set-Location plugin
npm ci
npm run build
npm test
~~~

本地打包使用 TypeScript、esbuild 和 ZIP 打包脚本。Zotero 10.0.1 要求清单中必须存在更新地址，因此本地发行包默认使用保留域名 `https://updates.zut.invalid/updates.json` 作为不可解析占位地址，不会获得自动更新；公开发布时应通过 `ZUT_UPDATE_URL` 环境变量传入真实 HTTPS 更新清单地址。构建产物为 plugin/.scaffold/build/zotero-unified-translator.xpi。

根目录执行以下命令会构建、验证并复制到 release：

~~~powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\package-plugin.ps1
~~~

后端测试：

~~~powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-backend.ps1 -Dev
Set-Location server
.venv\Scripts\python.exe -m pytest
~~~

自动化测试使用模拟服务，不会调用真实收费翻译接口。当前包含 XPI 启动注册、凭据更新、二进制 PDF 读写、保留注释评论、跨来源下载拦截、API 任务流程及真实引擎配置接口验证。详见 [验收记录](docs/verification.md)。

## 当前边界及后续工作

尚未实现：批量操作界面、逐句连续翻译、多服务并排对比、标题摘要翻译、OCR、快捷键配置、插件任务历史/取消按钮、自动更新发布站点、多用户后端。

当前是可安装验收版本，尚不是所有原始设想均实现的正式完整版。插件已在真实 Zotero 10.0.1 隔离档案中成功启用并注册设置页；Reader 人工操作和真实 LLM PDF 输出仍需完成验收，才能标记为正式可用版本。

## 设计依据与目录

依据 [Zotero 官方插件生命周期文档](https://www.zotero.org/support/dev/zotero_7_for_developers)、[Zotero 10 开发说明](https://www.zotero.org/support/dev/zotero_10_for_developers) 和本机 Zotero 10.0.1 程序源码包中的扩展校验实现检查集成接口；这些文档标题中的旧版本不代表本插件的兼容范围。

- [更新后的实施方案](ZUT-implementation-plan.md)
- [插件功能说明](docs/ZUT功能说明.md)
- [API 契约](docs/api-v1.md)
- [部署说明](docs/deployment.md)
- plugin/：插件源码、资源、构建和测试。
- server/：API、SQLite、Worker、引擎适配器。
- scripts/：Windows 安装、启动、停止和打包。
- release/：供安装验收的 XPI。

项目包声明 AGPL-3.0-or-later；第三方项目及来源见 [NOTICE](NOTICE)。公开分发前仍需补齐许可证全文和依赖许可审核，本次未发布到互联网。
