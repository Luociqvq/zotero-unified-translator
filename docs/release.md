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
  └─ https://zut.eieu.cn/updates.json              ← 自建更新通道（nginx 静态托管）
       └─ update_link
            └─ https://zut.eieu.cn/release/zotero-unified-translator-<版本>.xpi
```

仓库根目录的 `updates.json` 是清单的**唯一真相源**；服务器上的那份就是它，由部署脚本拉取。

同时保留两条 GitHub 镜像，供尚未升级到 v1.0.2 的客户端与手动下载使用：

```
updates.json 镜像：https://raw.githubusercontent.com/Luociqvq/zotero-unified-translator/main/updates.json
产物镜像：https://github.com/Luociqvq/zotero-unified-translator/releases/download/v<版本>/zotero-unified-translator.xpi
```

> ⚠️ **v1.0.0 的 XPI 内嵌的是占位域名 `updates.zut.invalid`，不会自动升级。**
> **v1.0.1** 起接入自动更新，`update_url` 指向 GitHub raw。
> **v1.0.2** 起改为指向自建的 `zut.eieu.cn`。
> 所以 **v1.0.1 是最后一个需要手动安装的版本**。

### 为什么是静态托管，不是自建服务

Zotero 的更新检查只需要两个静态文件：一份 JSON 清单，和一个它指向的 XPI。没有服务端逻辑可写，所以这里用 nginx 直接托管，而不是再跑一个应用 —— 少一个会挂的服务，也没有常驻内存要维护。

`updates.json` 显式带 `Cache-Control: no-cache`：**清单被缓存会让 Zotero 一直以为已装版本就是最新版，从而静默不再提示更新**。
XPI 则用**带版本号的文件名**（`zotero-unified-translator-<版本>.xpi`）并配 `immutable` 长缓存 —— 文件名不可变，缓存安全；若像早期那样用固定文件名，命中的旧缓存会通不过 `update_hash` 校验导致安装失败。

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
          "update_link": "https://zut.eieu.cn/release/zotero-unified-translator-1.0.2.xpi",
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

必须输出 `updates.json is consistent with the built XPI.` 才能继续。它检查：条目 id 与 XPI 内的插件 ID 一致、清单里的最新版本与 XPI 版本一致、`update_link` 是 https 且路径形如 `/release/zotero-unified-translator-<版本>.xpi`（或旧的 GitHub Releases 形式）、`update_hash` 与产物 sha256 逐字节相符。

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

### 8. 部署到更新服务器

清单与产物上传到 Release 之后，把自建通道同步过去。**必须用 tag 或 commit SHA 指定 ref，不要用 `main`** —— `raw.githubusercontent.com` 按路径缓存，刚推送的 `main` 往往还是旧内容，会静默部署成上一版：

```bash
# 在更新服务器上（us8h8g）执行。SHA 在本地取：git rev-parse v1.0.2
SHA=<v1.0.2 的 commit SHA>
curl -sSL -o /tmp/deploy-updates.sh \
  "https://raw.githubusercontent.com/Luociqvq/zotero-unified-translator/${SHA}/scripts/deploy-updates.sh"
sudo bash /tmp/deploy-updates.sh --domain zut.eieu.cn \
  --ref "v1.0.2" --expect-version 1.0.2
```

脚本会拉取该 ref 下的 `updates.json` 与落地页、从 GitHub Release 下载对应版本的 XPI、**校验 sha256 与清单一致后**才落盘、重新生成 nginx vhost 并 reload。任何一步不符就直接失败退出，不会把不一致的内容发布出去。

`--expect-version` 是专门防上面那个坑的：清单里的版本和预期不符就立刻失败，而不是"成功地"把旧版本又部署一遍。

> 首次部署需要证书时加 `--issue-cert`，详见 [docs/deployment-updates.md](deployment-updates.md)。

**顺序很重要**：必须是「先发 Release，再部署服务器」。脚本从 Release 取产物，顺序反了会取不到文件（并在校验环节失败退出）。

---

## 三、发布后自检

两条命令，覆盖"服务器发的是什么"和"老客户端能不能升上来"两件不同的事。

### 1. 线上通道是否正确

```bash
node scripts/verify-channel.mjs --domain zut.eieu.cn --expect-version 1.0.2
```

它按**客户端的方式**走一遍：读清单 → 检查 `Cache-Control` → 取 `update_link` 指向的产物 → 比对 sha256 与 `update_hash` → 与本仓库 `release/` 里的文件对比 → 打印证书剩余有效期。**任一项不符即以退出码 1 结束**，可以直接接进 CI。

| 检查 | 期望 |
|---|---|
| 清单可访问且是新版 | 200，`version` 为预期版本 |
| 清单未被缓存 | 响应头含 `no-cache`（缓存住会让 Zotero 静默不再提示更新） |
| 产物可下载且哈希正确 | 200，sha256 与 `update_hash` 一致 |
| 产物 MIME | `application/x-xpinstall` |
| 与本仓库产物 | 逐字节相同 |
| 证书 | 未过期（剩余不足 14 天会告警） |

### 2. 老版本客户端能不能真的升上来

```bash
# 取一个旧版本的已安装包作为起点
gh release download v1.0.1 --pattern "*.xpi" --output /tmp/zut-1.0.1.xpi --clobber
node scripts/verify-upgrade-path.mjs --xpi /tmp/zut-1.0.1.xpi \
  --expect-version 1.0.2 --zotero-version 10.0.5
```

上一条只验证"服务器现在发的是对的"；这一条验证**升级链路本身**，因为 `update_url` 是**烧进已安装包的**，发出去之后改不了。一个 1.0.1 的 `update_url` 若指向失效或被冻结的地址，只有从这里才看得出来。

它按 Zotero 的顺序检查：已安装包里有 `update_url` → 该地址可达且可解析 → 清单提供了**更新的**版本 → 条目里的 `applications.zotero` 范围**包含**指定的宿主版本（超出范围时 Zotero 静默丢弃该条目）→ `update_hash` 与实际下载的字节相符 → 下载到的包内部 `manifest.json` 版本与清单声明一致（能抓到"清单先行、产物是旧的"这种状态）。

> `strict_min_version` / `strict_max_version` 约束的是**宿主 Zotero 版本**（10.0.x），不是插件版本。所以要用 `--zotero-version` 指定一个真实宿主版本，否则只能做结构检查。
>
> 任一项不符即退出码 1。剩余真·人工项只有一条：

| 检查 | 方式 | 期望 |
|---|---|---|
| 客户端能发现更新 | Zotero「工具 → 插件」齿轮 →「检查更新」 | 提示有新版本 |

> `raw.githubusercontent.com` 有 CDN 缓存（`Cache-Control: max-age=300`），推送后若立刻取到旧内容，等 1–5 分钟再试。自建通道不受此影响（脚本已带 `no-cache` 头）。

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
| 清单明明是新版，用户却收不到更新 | 清单响应被缓存，Zotero 看到的是旧内容 | 确认响应头含 `Cache-Control: no-cache`（本项目的 vhost 已设置） |
| 提示有更新、下载后却安装失败 | XPI 用了固定文件名，命中了上一版的缓存 | 用带版本号的文件名；本项目服务器即按此约定托管 |
| 部署脚本报 `digest mismatch` | Release 里的产物与清单 hash 不符，或还没发 Release | 先完成第 6 步，确认第 7 步 digest 与清单一致后再部署 |
| 部署"成功"了，但线上还是上一版 | 用了 `--ref main`，raw CDN 仍在发旧内容 | 改用 tag 或 commit SHA，并带 `--expect-version`（见第 8 步） |
| 部署卡在 `downloading ...` 长时间无输出 | GitHub Release 的下载在某些网络下会挂住（连接建立但不传数据） | 已加 `--connect-timeout 15 --max-time 300`，超时即失败退出，不会挂死；重跑即可 |
| 线上清单指向的产物 404 | 部署脚本先发布清单、后安装产物，中途中断就会留下这个状态 | 已改为**产物先落盘、清单最后发布**；遇到该状态重跑部署即可恢复 |
| 清单宣告了新版本，但下载到的包还是旧的 | 清单与产物不同步（构建后只改了清单，或部署只发了一半） | `scripts/verify-upgrade-path.mjs` 会解包下载到的 XPI、比对其内部版本与清单声明；不一致即失败 |
| 升级脚本报 `strict_max_version` 不含宿主版本 | 清单里的宿主范围是按插件版本比的（常见误读），或范围确实写窄了 | `strict_min/max_version` 约束的是宿主 Zotero 版本（如 `10.0.*`），不是插件版本；按需放宽后重跑 |
| 升级脚本报 `ECONNRESET` / `ETIMEDOUT` | 网络抖动（本机代理环境尤其常见） | 脚本会自动重试 3 次；仍失败时**不要**当成链路问题，稍后重跑 |

---

## 五、不要做的事

- **不要移动或覆盖已发布的 tag**。已安装 1.0.x 的用户会按清单去取产物，改动历史会让哈希与实际内容对不上。
- **不要在清单里留占位域名**。`*.invalid` 会静默关闭自动更新。
- **不要跳过 `scripts/verify-updates.mjs`**。它拦的正是那些"上线后才发现"的问题。
- **不要只跑 `verify-channel.mjs` 就收工**。它证明服务器当下发的是对的，证明不了烧在旧包里的 `update_url` 还能把人带上来 —— 那是 `verify-upgrade-path.mjs` 的事。
