# ZUT 部署说明

目标 Zotero 10.0.1，插件/后端 0.1.8。最短安装与操作流程见 [README](../README.md)。

## Docker 远程部署（推荐）

整篇 PDF 后端是独立的 ZUT 服务，可以部署在远程服务器；使用插件的用户不需要在本机安装 Python。复制 `.env.example` 为 `.env`，至少设置后端访问口令和后端自己的 LLM 配置：

~~~dotenv
ZUT_AUTH_TOKEN=replace-with-a-long-random-token
ZUT_LLM_ENDPOINT=https://your-full-translation-provider/v1
ZUT_LLM_MODEL=your-full-translation-model
ZUT_LLM_API_KEY=
~~~

然后执行：

~~~powershell
docker compose up -d --build
docker compose logs -f
~~~

`ZUT_LLM_*` 只属于整篇 PDF 后端，与插件即时翻译的 `https://fanyi.eieu.cn/v1` 配置分开。`fanyi.eieu.cn` 可以作为后端自己的 LLM 提供商，但不会自动成为 PDF 后端地址。默认端口只绑定服务器本机，公网使用时应通过 HTTPS 反向代理暴露，并限制上传大小。

在 Zotero 设置中将整篇翻译后端地址填写为远程 ZUT 地址，例如 `https://pdf.example.com`，而不是 `https://fanyi.eieu.cn`；然后填写同一个 `ZUT_AUTH_TOKEN` 并点击「检查两个接口」。该按钮会同时测试即时翻译请求和整篇 PDF 后端；远程地址必须提供 `/api/v1/health`、`/api/v1/tasks` 等 ZUT PDF 任务接口。

## Windows 本机部署（可选）

只有选择本机运行时才需要 Python 3.12 x64。根目录执行：

~~~powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-backend.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-backend.ps1
~~~

按启动提示输入后端 Token 和整篇翻译后端的 LLM Key。默认 LLM 示例为 `https://api.openai.com/v1` 和 `gpt-4o-mini`；也可预先设置 ZUT_LLM_ENDPOINT、ZUT_LLM_MODEL。脚本不自动保存密钥，支持进程环境变量或用户提供的 .env（文件值优先），只读取 ZUT_ 开头的配置。

默认监听 127.0.0.1:8890，数据在项目根目录 data；后台启动 API 与 Worker。不要重复启动多个 Worker。服务就绪检查不代表真实 LLM 请求成功。

停止：

~~~powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\stop-backend.ps1
~~~

自定义数据目录时使用 -DataDir。停止会中断翻译，重新启动后可重提失败任务。

## 手动运行（调试）

在设置好同一组 ZUT_ 环境变量、PYTHONPATH 和绝对 ZUT_DATA_DIR 的两个终端分别执行：

~~~powershell
server\.venv\Scripts\python.exe -m zut_server
server\.venv\Scripts\python.exe -m zut_server.worker
~~~

后端自身不自动解析 .env；由启动脚本或 Docker 注入。请勿在两个终端设成不同数据目录。

## Docker 说明

创建自己的 .env，参照根目录 .env.example，至少设置 ZUT_AUTH_TOKEN、ZUT_LLM_API_KEY、ZUT_LLM_ENDPOINT、ZUT_LLM_MODEL。后端内部当前使用 pdf2zh-next 2.9.0 处理 PDF，它是 Python 依赖而不是 Zotero 插件。

~~~powershell
docker compose up -d --build
docker compose logs -f
docker compose down
~~~

API/Worker 共享 zut-data 数据卷，默认端口仅本机可访问。镜像包含 Python 引擎及基础系统依赖；初次真实翻译可能下载字体/布局资源。Docker Desktop 不在本次验证环境中，因此未声明该构建已通过。

## 远程

仅供单用户或完全互信环境。部署者配置 HTTPS、反向代理、上传限制、备份和访问口令。当前没有每用户文件隔离，不能直接开放给不互信用户。

## 清理

停止正在执行的翻译后，保持 ZUT_DATA_DIR 正确，执行 python -m zut_server.cleanup。删除创建时间超过 TTL 的终态任务及后端文件；不能恢复。该操作不删除 Zotero 已导入附件，也不处理第三方引擎在用户目录创建的缓存。

## 测试模式

仅验证流程时设置 ZUT_ENGINE=mock、ZUT_ENABLED_ENGINES=mock、ZUT_ALLOW_MOCK_ENGINE=1。插件 UI 不提供 mock 选择，使用后端 API/pytest 测试。mock 输出与输入相同，不验证翻译效果。
