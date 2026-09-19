# 自建更新通道部署

本文档说明把 ZUT 插件更新通道部署到自建服务器（`zut.eieu.cn`）的方式、依赖与排障。

常规发版流程见 [release.md](release.md)，这里只讲**服务器侧**。

---

## 一、这条通道是什么

只有两个静态文件：

| 路径 | 内容 | 缓存策略 |
|---|---|---|
| `/updates.json` | Zotero 的 JSON 更新清单（来自仓库根目录同名文件） | `no-cache` |
| `/release/zotero-unified-translator-<版本>.xpi` | 对应版本的安装包 | `immutable` 长缓存 |

外加一个给人看的落地页 `/index.html`（会自动读出清单里的最新版本）。

**没有服务端程序。** Zotero 的更新检查只需要清单 + 它指向的 XPI，所以这里用 nginx 直接托管静态文件，不额外起应用 —— 少一个会挂的服务，也没有常驻内存要维护。任何"更新服务挂了"的可能，都收敛成"nginx 挂了"，而那同时意味着服务器上所有站点都挂了，不会被单独漏掉。

---

## 二、服务器环境（已核实）

| 项 | 值 |
|---|---|
| 主机 | `us8h8g` / `154.202.118.93`，Ubuntu 22.04 |
| 面板 | 小皮面板（XP-Panel），站点根 `/xp`，服务 `xpd.service` |
| **运行中的 nginx** | `/xp/server/nginx/sbin/nginx` **v1.30.4** |
| nginx 配置 | `/xp/server/nginx/conf/nginx.conf` |
| vhost 目录 | `/xp/panel/vhost/nginx/<域名>.conf` |
| 站点根目录 | `/xp/www/<域名>` |
| nginx 运行用户 | `www` |
| 证书 | Let's Encrypt，`/etc/letsencrypt/live/<域名>/` |
| ACME webroot | `/var/www/certbot` |
| certbot | 1.21.0（webroot 模式） |

> ⚠️ **两个 nginx，别用错**
> 系统包自带的 `/usr/sbin/nginx`（v1.18.0）也装着，但它的 `nginx.service` 处于 **failed** 状态、从未在跑。
> 真正对外服务的是面板自带的 **v1.30.4**。用错二进制会出现"`nginx -t` 通过但改动不生效"。
> 脚本里通过 `NGINX_BIN` 显式指定，避免踩这个坑。

现有站点（同域体系，供参考对照）：`fanyi.eieu.cn`（即时翻译）、`pdf2zh.eieu.cn`（整篇后端）、`zotero.eieu.cn`、`subapi.eieu.cn`、`cpa.eieu.cn`、`grokapi.eieu.cn`。

---

## 三、首次部署

### 1. 绑定域名

在 `eieu.cn` 的 DNS 服务商处加一条 A 记录：

```
zut.eieu.cn.   A   154.202.118.93
```

验证（在任意机器上）：

```bash
getent hosts zut.eieu.cn     # 期望输出 154.202.118.93  zut.eieu.cn
```

### 2. 部署（含签证书）

```bash
SHA=<当前 main 的 commit SHA>
curl -sSL -o /tmp/deploy-updates.sh \
  "https://raw.githubusercontent.com/Luociqvq/zotero-unified-translator/${SHA}/scripts/deploy-updates.sh"
sudo bash /tmp/deploy-updates.sh --domain zut.eieu.cn --issue-cert
```

用 commit SHA 而不是 `main` 拉脚本：raw CDN 按路径缓存，分支名可能拿到旧内容（详见第四节）。

不带 `--issue-cert` 时只部署 HTTP；加上后，脚本会在证书缺失时调用 certbot 走 **HTTP-01** 校验（复用服务器上已有的 Let's Encrypt 账号），签发成功再把 vhost 切换到 HTTPS。

> 证书签发**要求域名已解析到本机且 80 端口公网可达**。解析没生效时会报 `certbot failed`，此时先确认第 1 步。

### 3. 公网验证

```bash
curl -s https://zut.eieu.cn/updates.json
curl -sSI https://zut.eieu.cn/updates.json | grep -i cache-control   # 应含 no-cache
```

---

## 四、日常部署（每次发版）

发完 GitHub Release 之后：

```bash
SHA=<v1.0.2 的 commit SHA>       # 本地取：git rev-parse v1.0.2
curl -sSL -o /tmp/deploy-updates.sh \
  "https://raw.githubusercontent.com/Luociqvq/zotero-unified-translator/${SHA}/scripts/deploy-updates.sh"
sudo bash /tmp/deploy-updates.sh --domain zut.eieu.cn \
  --ref v1.0.2 --expect-version 1.0.2
```

> ⚠️ **不要用 `--ref main`。**
> `raw.githubusercontent.com` **按路径缓存**，且查询串（`?t=…`）绕不过去 —— 实测刚推送后重新按同一路径拉取，拿到的仍是推送前的内容。
> 按分支名部署，会在发版后几分钟内**静默地把上一版又部署一遍**，而且脚本会报"成功"。
> 所以：ref 一律用不可变的 **tag 或 commit SHA**（路径全新 ⇒ 不命中旧缓存），并配合 `--expect-version` 断言。
> 同理，取脚本本身也要用 SHA，否则你执行的可能是旧版脚本。

脚本是**幂等**的，重复执行安全。它会：

1. 从仓库 `${REF:-main}` 拉 `updates.json` 与 `deploy/site/index.html`；
2. 解析清单里**最新那条**条目，取出 `version` 与 `update_hash`；
3. 从 GitHub Release 下载 `v<版本>` 的 XPI；
4. **校验下载文件的 sha256 与清单一致**，不一致直接失败退出，不落盘；
5. 以版本化文件名安装产物（`-<版本>.xpi`），并维护一个指向它的稳定别名 `zotero-unified-translator.xpi`；
6. **最后**才把清单与落地页落盘 —— 见下方"发布顺序"；
7. 按证书是否存在重新生成 vhost，`nginx -t` 通过后 reload；
8. 通过 loopback 回读清单，确认对外服务的版本与预期一致。

**顺序必须是「先发 Release，再部署服务器」** —— 脚本从 Release 取产物。

### 发布顺序（不要改回去）

新内容一律先落到临时目录，校验通过后才发布，且**产物在前、清单在后**：

```
拉清单 → 解析 → 下载产物 → 校验 sha256 → 装产物 → 发布清单与落地页
```

原因：清单是**客户端唯一读取的东西**（它只读 `updates.json`）。如果清单先上线、产物还没装好，那么所有客户端都会被告知"有新版本"，然后下载失败 —— 而 Zotero 在界面上不会解释原因。

这个 bug 真实发生过一次：GitHub Release 的下载在某些网络下会**建立连接后不传数据**，脚本没有超时，于是卡死在那里；而清单已经发布出去，指向一个那时还不存在的文件。所以：

- 所有网络请求都带 `--connect-timeout 15 --max-time 120`（产物下载 300 秒），**超时即失败退出**，不会无限挂住；
- 落盘顺序改成产物优先。

### 部署后的自检

在**本机**（不是服务器上）执行，走公网：

```bash
node scripts/verify-channel.mjs --domain zut.eieu.cn --expect-version 1.0.2
```

它按客户端的方式把清单跟随到底，任一项不符即以退出码 1 结束。服务器侧的 loopback 回读只能证明 nginx 配置正确，证明不了公网可达、证书有效、CDN 没在发旧内容。

还要跑一次**升级链路**检查，它会从一个已安装的旧版 XPI 出发、顺着它内嵌的 `update_url` 走完 Zotero 的检查流程：

```bash
gh release download v1.0.1 --pattern "*.xpi" --output /tmp/zut-1.0.1.xpi --clobber
node scripts/verify-upgrade-path.mjs --xpi /tmp/zut-1.0.1.xpi \
  --expect-version 1.0.2 --zotero-version 10.0.5
```

这两条命令回答的是不同问题：`verify-channel.mjs` 说"服务器现在发的是对的"，`verify-upgrade-path.mjs` 说"已经装在用户机器上的旧版能不能被带上来"。后者更接近用户视角，因为 `update_url` 是烧进已安装包的、发出去就改不了。详见 [发版与自动更新维护](release.md) 第三节。

---

## 五、排障

| 现象 | 原因 | 处理 |
|---|---|---|
| 脚本报 `nginx binary not found` | 面板 nginx 路径不同 | 用 `NGINX_BIN=/实际路径/nginx` 覆盖 |
| 改动不生效 | 改的是 `/etc/nginx/`（系统 nginx，没在跑） | vhost 必须放 `/xp/panel/vhost/nginx/` |
| `nginx -t` 通过但 443 不响应 | 证书路径不存在，vhost 仍是 HTTP-only 形态 | 先完成证书签发，再重跑脚本 |
| certbot 报 `Failed authorization procedure` | `zut.eieu.cn` 未解析到本机，或 80 被墙 | 核对 DNS；确认 `curl -I http://zut.eieu.cn/.well-known/acme-challenge/` 可达 |
| 用户始终收不到更新 | 清单被缓存 / `update_url` 指向旧地址 | 查响应头 `Cache-Control`；核对已装版本是否 ≥ 清单版本 |
| 更新通道整站 404 | webroot 或 vhost 被面板改动覆盖 | 重跑部署脚本（幂等，会重建） |
| 部署报"成功"但线上还是上一版 | 用了 `main` 之类的分支 ref，raw CDN 仍在发旧内容 | 改用 tag / commit SHA，并加 `--expect-version` |
| 执行的脚本行为与仓库不一致 | 取脚本时用了分支 ref，拿到旧文件 | 取脚本也用 commit SHA |
| 部署长时间无输出，卡在 `downloading …` | GitHub Release 的下载建立连接后不传数据（实测会挂几分钟） | 已加 `--connect-timeout 15 --max-time 300`，超时即失败退出；重跑即可 |
| 线上清单指向的产物 404 | 部署中途中断，且旧版脚本是"清单先发布、产物后安装" | 已改为产物优先落盘、清单最后发布；重跑部署即可恢复一致 |
| 公网取到的产物哈希不对 | `updates.json` 里的版本与 `release/` 里的包不是同一版，或客户端缓存 | 跑 `node scripts/verify-channel.mjs`，它会同时报出线上与本地两份的哈希 |

> 站点是通过面板纳管的。**不要手工编辑** `/xp/panel/vhost/nginx/zut.eieu.cn.conf` —— 那份文件每次部署都会重新生成，且面板改动也可能覆盖它。
> 要改配置，改仓库里的 `scripts/deploy-updates.sh`。

---

## 六、证书续期

certbot 已装并带 systemd timer，`zut.eieu.cn` 签发后会自动纳入续期；vhost 里的 ACME 路径始终保留在 80 端口，无需为续期做额外改动。手动检查：

```bash
certbot certificates
systemctl list-timers | grep certbot
```
