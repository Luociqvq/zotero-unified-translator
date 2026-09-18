# ZUT 1.0.0 验收记录

日期：2026-09-08。目标宿主：Zotero 10.0.1；本次自动化运行环境：Windows、Python 3.12.10、PowerShell 5.1。

## 已通过

| 检查 | 结果 |
|---|---|
| TypeScript 严格类型检查及 XPI 构建 | 通过 |
| 插件回归测试 | 9/9 通过 |
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
| 真实 Zotero 10.0.1 隔离启动 | 通过，当前 1.0.0 XPI 被识别为兼容、appDisabled=false；直接放入 profile extensions 目录时宿主默认 userDisabled=true |
| 插件 startup | 通过，当前 XPI 在模拟宿主中确认 Reader、菜单和设置注册；真实宿主的兼容性判定已通过 |

插件回归在 Node 模拟宿主中加载实际 XPI 的 bootstrap 与脚本，并检查 Reader、菜单和设置注册；它不是 Zotero GUI 测试。其余回归验证现代凭据接口、PDF 二进制读写、保留最新评论与去重、下载同源校验、XUL 标签。

后端测试的引擎配置使用真实已安装的 pdf2zh-next 2.9.0，但翻译事件用模拟流替代。没有调用真实付费模型。测试期间第三方 PyMuPDF 模块产生 5 条弃用警告，不影响测试通过。

## 安装产物

文件：release/zotero-unified-translator.xpi；大小：29,456 字节。

SHA-256：

~~~text
B9CC8BEEC89BF17D8CEB0772DB84B142A15CBAB40F8B4608835995AC49F1EC0D
~~~

版本：1.0.0；作者：Luoci；ID：zotero-unified-translator@zut.dev。
最低宿主：10.0.0；最高声明：10.0.*。后续重新打包可能因 ZIP 时间戳改变而产生不同校验值。

旧包被 Zotero 10.0.1 拒绝的根因已复现并定位：本机 `Extension.sys.mjs` 会把缺少 `applications.zotero.update_url` 的扩展判为无效。当前 1.0.0 已添加该必填字段。本地包使用 IANA 保留的 `.invalid` 域名，明确表示没有自动更新服务；公开发布时必须替换为真实 HTTPS 更新清单。

## 尚未通过实机验收的项目

- 通过 Zotero 图形界面手动执行“从文件安装”、禁用、启用、重启及设置控件操作；当前已完成真实宿主清单识别与兼容性判定，GUI 全流程仍需用户验收。
- 在真实 PDF Reader 中划词、复制、保存注释和导入译文。
- 真实模型 Key、联网字体/布局资源、真实 PDF 翻译质量。
- `fanyi.eieu.cn` 的真实译文返回；当前没有把 API Key 写入测试环境，因此只验证了接口连通性和鉴权行为。
- Docker 镜像构建及容器端到端运行；当前环境无 Docker 命令。
- macOS/Linux 宿主兼容性、复杂 PDF 样本及公开发行许可审核。

因此本产物应称为“可安装验收版本”，不能称为“全部功能已在 Zotero 10.0.1 实测通过”。下一步由用户在真实 PDF Reader 中验收划词及设置，再接入真实 LLM 做整篇 PDF 验收。
