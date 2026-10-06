# 方案 2：GitHub Actions + GitHub Pages（全免费）

零服务器、零运维、零成本的部署方式。由 **GitHub Actions 每天北京时间 05:00** 自动抓取并校验央视直播源，把结果作为**静态文件**提交回仓库，再由 **GitHub Pages** 托管。

## 为什么免费

| 组件 | 角色 | 费用 |
|---|---|---|
| GitHub Actions | 每天跑一次抓取+ffprobe 校验（runner 自带 ffmpeg） | 公开仓库**完全免费** |
| GitHub Pages | 托管静态页面与源文件 | 完全免费 |

## 与方案 1 的区别（重要）

| | 方案 1 自包含服务 | **方案 2 静态版** |
|---|---|---|
| 服务器 | 需要（如 Oracle 永久免费机） | **不需要** |
| 定时精度 | 精确到分 | ⚠️ 高峰可能延迟几分钟~几十分钟，偶发跳过 |
| 网页内播放 | ✅ 有 `/api/relay` 代理兜底 | ⚠️ 只能播跨域放行的源，失败自动切线路 |
| 动态接口 | ✅ 有状态/手动更新接口 | ❌ 无（纯静态） |
| 运维 | 要管机器 | ✅ 全自动 |

> 实用建议：**当播放失败提示"所有线路均播放失败"时，下载 m3u 用 PotPlayer / VLC / 电视盒子播放**，那边不受浏览器跨域限制，体验最稳。

## 目录结构（本方案相关）

```
cctv-live/
├── .github/workflows/update.yml   # 定时任务：每天 05:00 抓取校验并提交
├── scripts/build-static.mjs       # 构建脚本：复用 src/ 的抓取与校验逻辑
├── docs/                          # ★ GitHub Pages 发布目录
│   ├── index.html                 # 页面
│   ├── app.js / style.css         # 前端
│   ├── sources.json               # 构建产物：源数据（由 Actions 生成）
│   ├── sources.m3u                # 构建产物：播放器导入用
│   └── stats.json                 # 构建产物：精简统计
└── src/                           # 与方案 1 共用：config / fetcher / validator
```

## 部署步骤

### 1. 推到 GitHub

```bash
cd cctv-live
git init
git add .
git commit -m "feat: 央视直播源自动更新（静态版）"
git branch -M main
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

> 仓库设为 **Public**（公开），Actions 才完全免费；私有仓库会消耗每月 2000 分钟的免费额度（本项目每月约用 30–40 分钟，也够用）。

### 2. 开启 Pages

仓库 **Settings → Pages**：
- **Source** 选 `Deploy from a branch`
- **Branch** 选 `main`，文件夹选 **`/docs`**
- 保存后等 1–2 分钟，访问 `https://<你的用户名>.github.io/<仓库名>/`

### 3. 确认 Actions 权限

仓库 **Settings → Actions → General → Workflow permissions**：
- 选 **Read and write permissions**（否则工作流无法把结果提交回仓库）

### 4. 首次运行

两种方式触发：
- 到 **Actions → 更新央视直播源 → Run workflow** 手动点一次（建议先这样，立刻出数据）
- 或等每天北京时间 05:00 自动跑

跑完后 `docs/sources.json` 会自动更新并提交，页面随即生效。

## 定时说明

工作流里的 cron 是 **`0 21 * * *`**：因为 **GitHub Actions 使用 UTC 时区**，北京时间 05:00 = UTC 前一天 21:00。

```
北京时间 05:00  →  UTC 21:00（前一天）
```

⚠️ GitHub 官方明确说明：定时任务在高峰期（尤其整点）**可能延迟或被跳过**，这是平台限制，付费也无法消除。若对时间精度有硬性要求，请改用方案 1。

## 本地预览（无需推仓库）

```bash
cd cctv-live
node scripts/build-static.mjs                 # 生成 docs/ 下的静态数据
cd .. && python3 -m http.server 8080          # 在父目录起静态服务
# 浏览器打开 http://localhost:8080/cctv-live/docs/
```

> 用父目录起服务是为了模拟 Pages 的**子路径环境**，验证相对路径没问题。

## 常见问题

- **页面显示"数据尚未生成"**：Actions 还没跑过。去 Actions 页手动 Run workflow。
- **Actions 跑完但没有提交**：检查是否开了 `Read and write permissions`；另外若本次源与上次完全一致，工作流会跳过提交（正常行为）。
- **想改抓取时间**：改 `.github/workflows/update.yml` 里的 cron，注意换算成 UTC。
- **想增加频道或源池**：改 `src/config.js`（与方案 1 共用同一份配置）。
- **某天可用源变少**：公开源波动属正常，脚本带旧源兜底，下一轮会自动恢复。

## 免责声明

仅供学习与技术研究，所有直播源来自公开网络，版权归原权利人所有，请勿用于商业用途。
