# 发版与自动更新维护

本文档说明如何发布一个 ZUT 版本，以及如何维护自动更新链路。

自动更新一旦配错，**在生产里是静默失效的** —— Zotero 不会报错，只是永远不提示更新，用户一直停在旧版本。所以下面每一步都要走完。

---

## 一、自动更新是怎么工作的

Zotero 的更新检查器（`AddonUpdateChecker.sys.mjs`）行为如下：

- 只读取插件清单里的 `applications.zotero.update_url`，该字段没有就**不检查更新**。
- **只支持 JSON 更新清单**（`onLoad()` 直接 `JSON.parse`，没有 RDF 分支）。
- 请求时执行 `overrideMimeType("text/plain")`，所以**服务器返回的 Content-Type 不影响结果**。
- JSON 协议要求 `update_hash` 形如 `sha256:<hex>`；在 `extensions.checkUpdateSecurity` 为 true（默认）时，只要 `update_link` 是 **https**，hash 缺失也不会被丢弃，但仍建议填写以便完整性校验。
- `extensions.update.autoUpdateDefault` 默认为 **true**，所以有更新的插件会被自动升级。

本项目的链路：

```
插件清单 update_url
  └─ https://raw.githubusercontent.com/Luociqvq/zotero-unified-translator/main/updates.json
       └─ update_link
            └─ https://github.com/Luociqvq/zotero-unified-translator/releases/download/v<版本>/zotero-unified-translator.xpi
```

仓库根目录的 `updates.json` 就是那份清单。

> ⚠️ **v1.0.0 的 XPI 内嵌的是占位域名 `updates.zut.invalid`，不会自动升级。**
> 从 **v1.0.1** 起才真正接入自动更新。因此 v1.0.1 是最后一个需要手动安装的版本。

---

## 二、发一个版本

以把 `1.0.1` 升到 `1.0.2` 为例。

### 1. 改版本号

| 文件 | 位置 |
|---|---|
| `plugin/package.json` | `version` |
| `plugin/package-lock.json` | 顶层 `version` 与 `packages[""].version`（**不要**动依赖的版本） |
| `plugin/tests/regression.test.mjs` | `assert.equal(manifest.version, ...)` |
| `server/pyproject.toml` | `version` |
| `README.md` | 徽章、常见问题、版本与兼容性 |
| `release/安装说明.md` | 标题与正文 |
| `docs/ZUT功能说明.md`、`docs/deployment.md`、`docs/verification.md` | 版本引用 |

### 2. 构建并跑测试

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\package-plugin.ps1
```

该脚本会依次：`npm ci` → 类型检查 → 构建 XPI → 回归测试 → 复制到 `release/` → 校验 `updates.json`。

在 `updates.json` 还没更新时，最后一步会**故意失败**，这是预期行为。

### 3. 更新 updates.json

先取产物的 sha256：

```powershell
(Get-FileHash .\release\zotero-unified-translator.xpi -Algorithm SHA256).Hash.ToLower()
```

然后把 `updates.json` 里对应条目的 `version`、`update_link`、`update_hash`、`update_info_url` 改成新版本，例如：

```json
{
  "addons": {
    "zotero-unified-translator@zut.dev": {
      "updates": [
        {
          "version": "1.0.2",
          "applications": {
            "zotero": { "strict_min_version": "10.0.0", "strict_max_version": "10.0.*" }
          },
          "update_link": "https://github.com/Luociqvq/zotero-unified-translator/releases/download/v1.0.2/zotero-unified-translator.xpi",
          "update_hash": "sha256:<第 3 步算出的哈希>",
          "update_info_url": "https://github.com/Luociqvq/zotero-unified-translator/releases/tag/v1.0.2"
        }
      ]
    }
  }
}
```

> 维护约定：**只保留最新一条**。如果将来出现"某档 Zotero 版本装不了最新版"的情况，再在数组里追加旧条目，Zotero 会自动挑选与宿主版本兼容的最新项。

### 4. 再跑一次校验

```bash
node scripts/verify-updates.mjs
```

必须输出 `updates.json is consistent with the built XPI.` 才能继续。它检查：条目 id 与 XPI 内的插件 ID 一致、清单里的最新版本与 XPI 版本一致、`update_link` 是 https 且路径形如 `/releases/download/v<版本>/zotero-unified-translator.xpi`、`update_hash` 与产物 sha256 逐字节相符。

### 5. 提交、打标签、推送

```bash
git add -A
git commit -m "Release v1.0.2"
git tag -a v1.0.2 -m "Zotero Unified Translator v1.0.2"
git push origin main
git push origin v1.0.2
```

> 本机代理会拦 `github.com:443`，HTTPS 推送会报 `CONNECT tunnel failed, response 502`。
> 用 SSH remote 即可：`git@github.com:Luociqvq/zotero-unified-translator.git`。

### 6. 创建 Release 并上传 XPI

```bash
gh release create v1.0.2 \
  --title "Zotero Unified Translator v1.0.2" \
  --notes-file <发布说明.md> \
  release/zotero-unified-translator.xpi
```

**上传的文件名必须是 `zotero-unified-translator.xpi`** —— `updates.json` 里的下载地址按这个文件名拼。

### 7. 核对线上哈希

```bash
gh release view v1.0.2 --json assets
```

把返回的 `digest`（形如 `sha256:...`）与 `updates.json` 里的 `update_hash` 比对，**必须一致**。不一致说明上传了别的文件或清单没更新。

---

## 三、发布后自检

| 检查 | 命令 / 方式 | 期望 |
|---|---|---|
| 清单可访问且是新版 | `curl -s https://raw.githubusercontent.com/Luociqvq/zotero-unified-translator/main/updates.json` | 返回 JSON，`version` 为新版本 |
| 清单 hash 与线上产物一致 | 见上一步第 7 条 | 一致 |
| 客户端能发现更新 | Zotero「工具 → 插件」齿轮 →「检查更新」 | 提示有新版本 |

> `raw.githubusercontent.com` 有 CDN 缓存。推送后若立刻取到旧内容，等 1–5 分钟再试（可在 URL 后加 `?t=<时间戳>` 绕过缓存验证）。

---

## 四、常见坑

| 现象 | 原因 | 处理 |
|---|---|---|
| 校验脚本报 `update_hash does not match` | 清单 hash 还是上一版，或构建后忘了取新 hash | 重跑第 3 步 |
| 校验脚本报 `newest entry is X but the built XPI is Y` | 版本号没改全（漏了 `package.json`） | 补齐版本号后重新构建 |
| Zotero 完全不检查更新 | XPI 内 `update_url` 是占位域名或缺失 | 确认 `plugin/package.json` 的 `config.updateURL` 是真实地址；构建后可在 XPI 的 `manifest.json` 里核对 |
| 提示有更新但下载失败 | `update_link` 里的版本号与 tag 不一致，或 Release 里没传 XPI | 核对 tag、文件名与 URL |
| 下载后被拒绝安装 | `update_hash` 与实际文件不符 | 重新上传或用正确 hash |
| `strict_max_version` 挡掉更新 | 清单里声明的最高宿主版本低于用户 Zotero | 按需放宽 `strict_max_version`（放宽前先确认兼容性） |

---

## 五、不要做的事

- **不要移动或覆盖已发布的 tag**。已安装 1.0.x 的用户会按清单去取产物，改动历史会让哈希与实际内容对不上。
- **不要在清单里留占位域名**。`*.invalid` 会静默关闭自动更新。
- **不要跳过 `scripts/verify-updates.mjs`**。它拦的正是那些"上线后才发现"的问题。
