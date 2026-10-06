# 央视直播源自动更新网站（CCTV Live）

一个自托管的网站，**只收录中央台（CCTV-1 ~ CCTV-17 及 CCTV-5+）**。
每天**北京时间早上 05:00** 自动从多个公开源池抓取央视直播源 → 逐条用 `ffprobe` 校验 → 只保留真正能播的线路 → 刷新自己的数据，做到"**点开就能播**"。

## 两种部署形态（按需二选一，互不干扰）

| | **方案 1：自包含 Node 服务** | **方案 2：Actions + Pages（全免费）** |
|---|---|---|
| 入口 | `npm start` | 见 [`DEPLOY-STATIC.md`](./DEPLOY-STATIC.md) |
| 需要服务器 | 是（如 Oracle 永久免费层） | **否** |
| 定时精度 | ✅ 精确 05:00 | ⚠️ 平台可能延迟 |
| 网页内播放 | ✅ 带反向代理兜底 | ⚠️ 仅跨域放行的源 |
| 成本 | 一台常开机器 | **¥0** |
| 适合 | 完整体验 | 零成本零运维 |

> 两套方案**共用** `src/config.js`、`src/fetcher.js`、`src/validator.js`，配置一次即可。
> 方案 2 相关文件：`.github/workflows/update.yml`、`scripts/build-static.mjs`、`docs/`。

---

## 方案 1 说明

## 特性

- **每天 05:00 自动更新**：定时任务显式指定 `Asia/Shanghai` 时区，无论服务器在哪个国家，都按北京时间执行。
- **多源池聚合**：从 Guovin/TV、iptv-org、vbskycn、YanG-1989、wwb521 等 5 个池聚合候选源（每个池都带备用镜像），单池失效不影响整体。
- **真实可用性校验**：每条源都用 `ffprobe` 实际拉流探测（并发 30），能解析出视频流才算可用，并记录**分辨率**和**响应延迟**。
- **自动优选**：每频道按「分辨率高 → 延迟低」排序，保留最优的若干条线路。
- **旧源兜底**：若某频道本轮全网 0 可用，保留上一轮该频道的旧源并标记为「缓存源」，避免频道整块消失。
- **网页内直接播放**：内置 HLS.js 播放器，点击频道即可看；支持多线路切换、失败自动切下一条。
- **一行导入盒子**：提供标准 `.m3u`，可直接导入 PotPlayer / VLC / 电视盒子。

## 实测效果（2026-10-06 首次运行）

| 指标 | 数值 |
|---|---|
| 源池数量 | 5 |
| 聚合候选源 | 166 条 |
| 校验通过 | 75 条 |
| 最终发布 | **72 条** |
| 频道覆盖 | **18 / 18** |
| 耗时 | 约 62 秒 |

## 快速开始

```bash
cd cctv-live
npm install
npm start            # 启动网站，默认 http://localhost:3000
```

首次启动若还没数据，会自动后台跑一次全量更新（约 1 分钟）。
也可以手动触发：

```bash
npm run update       # 命令行执行一次完整更新
```

## 目录结构

```
cctv-live/
├── server.js            # Express 服务：API + 静态站点
├── src/
│   ├── config.js        # 频道表 / 源池 / 定时(05:00 Asia/Shanghai) / 校验参数
│   ├── fetcher.js       # 多源池下载 + m3u 解析 + 按频道聚合去重
│   ├── validator.js     # ffprobe 并发校验
│   ├── updater.js       # 全流程编排 + 写盘 + 日志
│   └── scheduler.js     # node-cron 定时任务
├── public/              # 前端（index.html / app.js / style.css）
└── data/
    ├── sources.json     # 校验后的活源（网站数据源）
    ├── sources.m3u      # 供播放器导入
    └── history.log      # 每日更新日志
```

## API

| 接口 | 说明 |
|---|---|
| `GET /api/channels` | 全部频道及可用源（JSON） |
| `GET /api/status` | 状态：更新时间、统计、定时配置 |
| `GET /api/playlist.m3u` | 获取/下载 m3u（加 `?download=1` 触发下载） |
| `GET /api/update` | 手动触发一次更新（可用 `UPDATE_TOKEN` 环境变量保护） |
| `GET /api/diagnose` | 查看当前各源池抓取情况（不写盘） |
| `GET /api/probe?url=` | 探测单条源是否可用 |
| `GET /api/relay?url=` | 反向代理播放（应对浏览器跨域受限的源） |

## 常用配置（`src/config.js`）

| 配置项 | 默认 | 说明 |
|---|---|---|
| `cronExpression` | `0 5 * * *` | 每天 05:00（改这里可调整时间） |
| `cronTimeZone` | `Asia/Shanghai` | 定时时区，保证按北京时间 |
| `maxSourcesPerChannel` | `5` | 每频道保留的线路数 |
| `probeConcurrency` | `30` | 校验并发数 |
| `probeTimeoutMs` | `10000` | 单条探测超时 |
| `port` | `3000` | 服务端口（也可用环境变量 `PORT`） |

## 服务器长期部署

### 方式一：PM2（推荐）

```bash
npm i -g pm2
pm2 start server.js --name cctv-live
pm2 save && pm2 startup        # 开机自启
```

### 方式二：systemd

```ini
# /etc/systemd/system/cctv-live.service
[Unit]
Description=CCTV Live Source Auto Updater
After=network.target

[Service]
WorkingDirectory=/path/to/cctv-live
ExecStart=/usr/bin/node server.js
Restart=always
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload && systemctl enable --now cctv-live
```

> 依赖：**Node.js 18+**（用到原生 fetch）与 **ffmpeg/ffprobe**（校验用）。
> Ubuntu: `sudo apt install -y ffmpeg`

## 常见问题

- **某次更新可用源变少？** 属正常现象，公开源本身会波动；系统已做多池聚合 + 旧源兜底，下一轮会自动恢复。
- **浏览器里点播放转圈不出画面？** 部分源限制了浏览器跨域，可改用 m3u 导入本地播放器，或走 `/api/relay?url=` 代理。
- **想增加/减少频道？** 修改 `src/config.js` 的 `CHANNELS` 数组即可。
- **想再加源池？** 在 `src/config.js` 的 `SOURCE_POOLS` 里追加 `{ name, url, mirrors }`。

## 免责声明

本项目**仅供学习与技术研究**。所有直播源均来自公开网络，版权归原权利人所有，请勿用于任何商业用途。使用者应自行承担合规责任。
