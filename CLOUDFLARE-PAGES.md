# 用 Cloudflare Pages 给网站加速（国内访问优化）

GitHub Pages 在国内不稳定（DNS 污染、连接重置、时快时慢）。本方案把网站**多托管一份到 Cloudflare Pages**，并**启用跨域代理**，让网页内可播频道从 **4/18 提升到 10/18**（实测数据）。

## 为什么必须加代理（实测结论）

我做了一次全频道实测，这是两个方案的真实差距：

| 播放方式 | 网页内可播频道 | 原因 |
|---|---|---|
| GitHub Pages 直连 | **4 / 18** | 绝大多数公开源不返回 CORS 头，浏览器直接拦截 |
| Cloudflare Pages + 代理 | **10 / 18** | 由 Cloudflare 服务端拉流再转发，绕过浏览器跨域限制 |

> **这是最关键的发现**：不管用哪个托管平台，**只要没有服务端代理，网页里就只能在极少数频道上播放**。
> 加了 Cloudflare Pages Functions 代理后，可播频道翻了一倍多。

**剩下 8 个频道为什么还是不行？**
不是代理的问题，是**源本身的分片服务器从境外拉不动**（实测分片返回超时/HTTP 000）。这类源在国内可能反而更快，但无法从云端校验。这些频道请用 m3u 导入本地播放器。

---

## 结果对比

| | GitHub Pages | Cloudflare Pages（本方案） |
|---|---|---|
| 地址 | `vigez.github.io/tvlive` | `tvlive.pages.dev` |
| 国内访问 | ⚠️ 不稳定 | ✅ 明显更好 |
| **网页内可播频道** | **4/18** | **10/18** |
| 费用 | 免费 | 免费（不限量） |
| 自动更新 | ✅ | ✅ 跟着仓库自动同步 |
| 需要备案 | 否 | 否 |

---

## 前置：代码改动（已帮你改好，直接推仓库即可）

| 文件 | 改动 | 作用 |
|---|---|---|
| `docs/functions/relay.js` | **新增** | Cloudflare Pages Function，跨域代理 `/relay` |
| `docs/hls.min.js` | **新增** | 播放器本地化，去掉境外 CDN 依赖 |
| `docs/index.html` | 引用本地 hls.js + CDN 回退 | 页面零外部依赖 |
| `docs/app.js` | 自动探测并使用代理 | 有代理走代理，没有则回退直连 |
| `scripts/build-static.mjs` | 自动检查/补齐 hls.min.js | 构建时保证脚本存在 |
| `.github/workflows/update.yml` | 提交时带上 hls.min.js | 防止文件丢失 |

### 代理的关键技术点（踩过的坑）

`relay.js` 里有一处**必须这样写**的地方，否则分片全部 404：

```js
// 正确：以【跳转后的最终地址】为基准解析分片
const base = new URL(upstream.url || target);

// 错误：用原始地址，会导致拼出的分片地址完全不对
const base = new URL(target);
```

**原因**：很多直播源会 **302 跳转**到带时效签名的地址（如 `?tm=1791281977&key=f89f9045...`），
分片路径必须相对**跳转后的地址**解析，用原始地址拼出来的是错的。

另外代理还做了：
- 把 `.m3u8` 里的分片地址**重写为走代理的绝对地址**（否则浏览器仍会跨域失败）
- 处理 `#EXT-X-KEY` / `#EXT-X-MAP` 里的 `URI="..."` 标签
- **限制只代理直播流资源**（m3u8/ts/m4s/mp4），防止被当成开放代理滥用

---

## 部署步骤

### 第 1 步：把改动推到 GitHub

```bash
cd cctv-live
git add -A
git commit -m "feat: 添加 Cloudflare Pages 跨域代理 + 播放器本地化"
git push
```

### 第 2 步：注册 Cloudflare

打开 https://dash.cloudflare.com/sign-up ，邮箱注册即可（免费，**不需要绑卡**）。

### 第 3 步：创建 Pages 项目并连接仓库

1. 左侧菜单 → **Workers & Pages**（部分界面在 **Compute (Workers)** 下）
2. **Create** → 选 **Pages** 标签 → **Connect to Git**
3. 授权 GitHub：选 **Only select repositories** → 勾选 **`vigez/tvlive`** → 授权

### 第 4 步：填写构建配置（照抄，这里最容易错）

| 配置项 | 填什么 |
|---|---|
| **Project name** | `tvlive` → 地址将是 `tvlive.pages.dev` |
| **Production branch** | `main` |
| **Framework preset** | **`None`** ← 千万别选框架 |
| **Build command** | **留空** |
| **Build output directory** | **`docs`** ← 关键！ |

> `docs/` 里已经是 GitHub Actions 构建好的成品，Cloudflare 只需当静态站点发布，**无需再编译**。
> Cloudflare 会自动识别 `docs/functions/` 目录，把 `relay.js` 注册为 `/relay` 路由——这就是代理生效的关键。

填完点 **Save and Deploy**。

### 第 5 步：等待部署并验证

30 秒~1 分钟后看到 `✅ Success`，地址：

```
https://tvlive.pages.dev
```

**验证代理是否生效**（重要）：

打开网站，看左侧统计区有没有这行字：

```
播放模式：跨域代理已启用（网页内可播全部频道）
```

- **有** → 代理已工作，去点几个频道试试，应该能播的比 GitHub Pages 上多得多
- **没有，显示"直连模式"** → 检查 `docs/functions/relay.js` 是否提交到仓库了

### 第 6 步：验证自动同步

Cloudflare Pages 默认**监听仓库每次提交**。所以：

1. GitHub Actions 每天 5:00 更新 `docs/sources.json` 并提交
2. Cloudflare 自动重新部署
3. 网站自动更新

去 Pages 项目的 **Deployments** 标签可以看到每次部署记录。

---

## （可选）绑定自己的域名

1. 项目 → **Custom domains** → **Set up a custom domain**
2. 输入域名，如 `tv.你的域名.com`
3. 按提示加 CNAME 记录
4. **不需要备案**（服务器在境外）

---

## 双站点并行（推荐）

**不用二选一**，两个地址同时存在，互为备份：

| 地址 | 定位 |
|---|---|
| `tvlive.pages.dev` | **国内推荐入口**（有代理，可播频道多） |
| `vigez.github.io/tvlive` | 备份 |

---

## 常见问题

| 现象 | 原因与解决 |
|---|---|
| 部署成功但 404 | **Build output directory 填错**，必须是 `docs` |
| 显示"直连模式"而非"代理已启用" | `docs/functions/relay.js` 没提交，或目录结构不对（必须是 `docs/functions/relay.js`） |
| 代理生效了但部分频道还是播不了 | **源本身的问题**（分片服务器从境外拉不动）。实测 10/18 可用，其余请用 m3u 导入本地播放器 |
| 页面白屏、样式丢失 | Framework preset 被误设成框架，改回 **None** |
| 国内还是打不开 | 你的网络对 Cloudflare 也不通。可加 Gitee Pages 或国内 OSS 作第三备份（需实名/备案） |
| Cloudflare 构建失败 | 本项目无需构建；一般是 output 目录填错，或在 Settings → Build 里清空构建命令 |

---

## 六、还想更快？（进阶，可选）

真正国内直连高速只有一条路：**国内云厂商对象存储 + 自定义域名**。

| 平台 | 国内速度 | 免费额度 | 备案要求 |
|---|---|---|---|
| 腾讯云 COS | 很快 | 有 | ⚠️ 绑自定义域名需备案 |
| 阿里云 OSS | 很快 | 有 | ⚠️ 绑自定义域名需备案 |
| Gitee Pages | 快 | 免费 | ⚠️ 需实名，服务有时暂停 |

做法：在 GitHub Actions 里加一步，把 `docs/` 同步到 COS/OSS（用 `coscmd`/`ossutil`，密钥存 GitHub Secrets）。
**代价**：实名 + 备案 + 配密钥。只是自己看的话，Cloudflare Pages 这一步就够了。

---

## 七、实测数据汇总

| 指标 | 数值 |
|---|---|
| 聚合候选源 | 166 条 |
| ffprobe 校验通过 | 79 条 |
| 发布 | 76 条 |
| 频道覆盖（源层面） | 18 / 18 |
| **网页直连可播** | **4 / 18** |
| **经代理可播** | **10 / 18** |

> 经代理成功播放的频道：CCTV-1、2、3、4、6、7、8、13、14、15
> 未能播放的频道：CCTV-5、5+、9、10、11、12、16、17（源分片服务器从境外不可达）
