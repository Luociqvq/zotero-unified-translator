# 第三方依赖与许可证清单

本文档记录 Zotero Unified Translator（ZUT）使用或依赖的第三方组件及其许可证，供分发与合规审查参考。

- **审计日期**：2026-09-18
- **审计方法**：PyPI JSON API（`license_expression` / `license` / License 分类器）、npm registry（`license` 字段）、GitHub License API（SPDX 标识）逐项核对
- **版本口径**：下表中的版本是各依赖在本文档声明约束下、审计当日可解析到的最新版本，不是锁定的精确版本；实际安装版本以解析结果为准

---

## 1. 结论摘要

| 结论 | 说明 |
|---|---|
| 插件 XPI 不含第三方运行时代码 | 源码仅使用相对路径 import，运行时只调用 Zotero 宿主 API |
| 后端存在 3 个强 copyleft（AGPL-3.0）组件 | `pdf2zh-next`、`babeldoc`、`PyMuPDF` |
| 与本项目许可证兼容 | 本项目为 AGPL-3.0-or-later，可整体按 AGPL-3.0 合规 |
| 商用闭源不可行 | AGPL 第 13 条要求网络服务使用者也能获得源码；PyMuPDF 闭源商用需另购 Artifex 商业许可 |

---

## 2. 插件（`plugin/`）

### 2.1 运行时代码

**无第三方运行时依赖。**

`plugin/src` 下所有 import 均为相对路径（`./`、`../`），未引入任何 npm 包。构建脚本 esbuild 只把自有 TypeScript 打包成 `content/scripts/zut.js`，XPI 内不包含第三方代码。

### 2.2 构建期依赖（不随 XPI 分发）

| 包 | 约束 | 许可证 |
|---|---|---|
| typescript | `^5.9.3` | Apache-2.0 |
| esbuild | `0.28.2` | MIT |
| adm-zip | `0.6.0` | MIT |
| @types/node | `^24.10.0` | MIT |
| zotero-types | `^4.1.0-beta.4` | MIT |

全部为宽松许可证，且均为开发期依赖，不进入分发包。

---

## 3. 后端（`server/`）

### 3.1 直接依赖（`server/requirements.txt`）

| 包 | 约束 | 许可证 |
|---|---|---|
| Flask | `>=3.1,<4` | BSD-3-Clause |
| pypdf | `>=5.0,<6` | BSD-3-Clause |
| waitress | `>=3.0,<4` | ZPL-2.1（Zope Public License） |
| **pdf2zh-next** | `==2.9.0` | **AGPL-3.0** |
| tomlkit | `>=0.13,<1` | MIT |
| pytest（仅开发） | `>=8.0,<9` | MIT |

### 3.2 pdf2zh-next 的直接依赖

`pdf2zh-next` 会连带安装以下组件（其 `requires_dist` 声明）：

| 包 | 许可证 | 备注 |
|---|---|---|
| **babeldoc** | **AGPL-3.0** | 版面分析与重排引擎 |
| **pymupdf**（Pin 为 `<1.25.3`） | **AGPL-3.0 或 Artifex 商业许可** | 双许可 |
| numpy | BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0 | |
| tqdm | MPL-2.0 AND MIT | MPL 为文件级弱 copyleft |
| gradio | Apache-2.0 | |
| gradio-pdf | Apache-2.0 | |
| gradio-i18n | Apache-2.0 | |
| fastapi | MIT | |
| uvicorn | BSD-3-Clause | |
| sse-starlette | BSD-3-Clause | |
| httpx | BSD-3-Clause | |
| pydantic | MIT | |
| pydantic-settings | MIT | |
| openai | Apache-2.0 | |
| requests | Apache-2.0 | |
| tenacity | Apache-2.0 | |
| tencentcloud-sdk-python-tmt | Apache-2.0 | 腾讯机器翻译 SDK |
| xinference-client | Apache-2.0 | |
| azure-ai-translation-text | MIT | |
| peewee | MIT | |
| deepl | MIT | |
| ollama | MIT | |
| fonttools | MIT | |
| rich | MIT | |
| pyyaml | MIT | |
| chardet | 0BSD | |
| legacy-cgi | PSF-2.0 | 仅 Python ≥3.13 需要 |

---

## 4. 强 copyleft 组件的影响

以下三个组件采用 **AGPL-3.0**，是本项目许可证层面最需要注意的部分：

1. **pdf2zh-next 2.9.0**（`license_expression: AGPL-3.0`）
2. **babeldoc 0.6.4**（SPDX: AGPL-3.0，上游仓库 `funstory-ai/BabelDOC`）
3. **PyMuPDF**（双许可：AGPL-3.0 或 Artifex 商业许可，上游仓库 `pymupdf/PyMuPDF`）

### 影响

- 后端 `server/` 通过 pdf2zh-next 的 **Python API 直接调用**（见 `server/zut_server/engines/pdf2zh_next.py`），构成衍生作品，因此后端必须以 AGPL-3.0 兼容条款分发 —— 本项目当前正是 AGPL-3.0-or-later，**合规**。
- AGPL-3.0 第 13 条：若把后端作为网络服务提供给他人使用，必须向使用者提供对应源码。本仓库源码公开，满足该要求。
- 若希望**闭源**或**商业托管**该后端，需要：
  - 替换 `pdf2zh-next` / `babeldoc` 为宽松许可的等价实现，或取得其权利人的另行授权；
  - 为 PyMuPDF 购买 Artifex 商业许可，或改用宽松许可的 PDF 库（如 pypdf 的能力尚不足以替代其版面重排）。
- `tqdm` 的 MPL-2.0 是文件级弱 copyleft：只要不修改其源文件即可正常使用，本项目未修改。

---

## 5. 尚未完成的审计项

1. **未生成完整 SBOM**。本文档覆盖插件全部构建依赖、后端全部直接依赖，以及 `pdf2zh-next` 的全部直接依赖；**更深层的传递依赖（约 100+ 包）未逐一核对**。建议在目标环境执行一次：

   ```bash
   pip install pip-licenses
   pip-licenses --format=markdown --with-urls --order=license
   ```

   或使用 `cyclonedx-py` / `syft` 生成标准 SBOM 后并入本文档。

2. **未做许可证原文归档**。AGPL/MPL 等要求随分发附带许可证文本的组件，若未来改为分发后端二进制产物，需要一并附带其 LICENSE 全文。

3. **本机 Zotero 宿主 API 的使用**不属于第三方依赖，见 Zotero 自身许可证。
