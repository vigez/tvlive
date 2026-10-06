# 央视直播源自动更新网站（CCTV Live）

一个自托管的网站，**只收录中央台（CCTV-1 ~ CCTV-17 及 CCTV-5+）**。
每天**北京时间早上 05:00** 自动从多个公开源池抓取央视直播源 → 逐条用 `ffprobe` 校验 + **实测真实带宽** → 把最快最清晰的线路排到最前面 → 刷新自己的数据，做到"**点开就能播，且不卡**"。

## 为什么要有「实测带宽」这一步

只看「能不能解析出视频流」是不够的。实测数据说明问题：

| 源 | 归属 | ffprobe 结论 | 实测带宽 | 实际体验 |
|---|---|---|---|---|
| 河北广电 CDN | 🇨🇳 中国电信 | 1080p 可用 | **62.9 Mbps** | 秒开、不卡 |
| 浙江华数 CDN | 🇨🇳 中国移动 | 1080p 可用 | **74.5 Mbps** | 秒开、不卡 |
| 美国某机房 A | 🇺🇸 Nocix | 1080p 可用 | 2.1 Mbps | 卡顿 |
| 美国某机房 B | 🇺🇸 Nocix | 1080p 可用 | **0.004 Mbps** | 完全没法看 |

**四条源 ffprobe 全都说"可用"，但体验差 3 万倍。**

如果只用 ffprobe 排序，播放器有 1/4 以上的概率拿到一条根本播不动的源 —— 用户感受到的就是"经常卡"。所以本项目**每条源都真实拉一段流，量出 Mbps**，再据此排序。

## 两种部署形态（按需二选一，互不干扰）

| | **方案 1：自包含 Node 服务** | **方案 2：Actions + Pages（全免费）** |
|---|---|---|
| 入口 | `npm start` | 见 [`DEPLOY-STATIC.md`](./DEPLOY-STATIC.md) |
| 需要服务器 | 是（如 Oracle 永久免费层） | **否** |
| 定时精度 | ✅ 精确 05:00 | ⚠️ 平台可能延迟 |
| 网页内播放 | ✅ 带反向代理兜底 | ⚠️ 仅跨域放行的源 |
| 成本 | 一台常开机器 | **¥0** |
| 适合 | 完整体验 | 零成本零运维 |

> 两套方案**共用** `src/config.js`、`src/fetcher.js`、`src/validator.js`、`src/score.js`，配置一次即可。
> 方案 2 相关文件：`.github/workflows/update.yml`、`scripts/build-static.mjs`、`docs/`。

### 方案 2.5：Cloudflare Pages 加速 + 跨域代理（国内推荐）

GitHub Pages 在国内不稳定，且**网页直连只能播 4/18 频道**（多数源不返回 CORS 头）。
用 Cloudflare Pages 托管并启用内置的跨域代理后，**网页内可播频道提升到 10/18**。

详见 **[`CLOUDFLARE-PAGES.md`](./CLOUDFLARE-PAGES.md)**。相关文件：`docs/functions/relay.js`、`docs/hls.min.js`。

---

## 方案 1 说明

## 特性

- **每天 05:00 自动更新**：定时任务显式指定 `Asia/Shanghai` 时区，无论服务器在哪个国家，都按北京时间执行。
- **多源池聚合**：从 Guovin/TV、iptv-org、vbskycn、YanG-1989、wwb521、Guovin-ipv6、fanmingming、kimwang1978 等 10 个池聚合候选源（每个池都带备用镜像），单池失效不影响整体。
- **真实可用性校验**：每条源都用 `ffprobe` 实际拉流探测（并发 30），能解析出视频流才算可用，并记录**分辨率**、**音轨**和**响应延迟**。
- **⭐ 实测带宽**：再用 `curl` 连续拉若干分片，量出每条源的**真实下载速率（Mbps）**。这是排序的主依据。
- **综合优选**：按「带宽(100分) + 分辨率(60分) − 延迟惩罚(15分)」打分，每频道保留最优的若干条线路。
- **IPv6 运营商源识别**：移动/联通的 IPv6 IPTV 源本机测不了速，但对同网段电视是内网速度，单独加分处理。
- **旧源兜底**：若某频道本轮全网 0 可用，保留上一轮该频道的旧源并标记为「缓存源」，避免频道整块消失。
- **网页内直接播放**：内置 HLS.js 播放器，点击频道即可看；支持多线路切换、失败自动切下一条。
- **一行导入盒子**：提供标准 `.m3u`，可直接导入 PotPlayer / VLC / 电视盒子。线路名直接标出**分辨率和实测带宽**，一眼看出哪条快。

## 实测效果（2026-10-06 运行）

| 指标 | 数值 |
|---|---|
| 源池数量 | 10 |
| 聚合候选源 | 约 180 条 |
| 校验 + 测速通过 | 约 80 条 |
| 最终发布 | 约 77 条 |
| 频道覆盖 | **18 / 18** |
| 耗时 | 约 2 分钟（含逐条测速） |

排序效果示例（首选线路）：

| 频道 | 改造前 | 改造后 |
|---|---|---|
| CCTV-13 | 随机 | **1080P / 53.2 Mbps** |
| CCTV-14 | 随机 | **1080P / 63.2 Mbps** |
| CCTV-16 | 随机 | **1080P / 11.2 Mbps** |
| CCTV-3 | 随机 | **1080P / 10.0 Mbps** |

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
│   ├── config.js        # 频道表 / 源池 / 打分权重 / 定时(05:00 Asia/Shanghai) / 校验参数
│   ├── fetcher.js       # 多源池下载 + m3u 解析 + 频道名归一化 + URL 清理 + 按频道聚合去重
│   ├── validator.js     # ffprobe 并发校验 + curl 分片实测带宽
│   ├── score.js         # 质量打分与排序（带宽主项 / 分辨率次项 / IPv6 特判）
│   ├── updater.js       # 全流程编排 + 写盘 + 日志
│   └── scheduler.js     # node-cron 定时任务
├── public/              # 前端（index.html / app.js / style.css）
└── data/
    ├── sources.json     # 校验后的活源（网站数据源），含每条源的实测 kbps
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
| `bandwidthOn` | `true` | 是否开启实测带宽（关掉可加快更新，但排序会不准） |
| `bandwidthSampleCount` | `5` | 每条源最多连拉几个分片测速 |
| `bandwidthBudgetMs` | `6000` | 每条源测速的时间上限 |
| `score.kbps` | 见文件 | 带宽分档阈值（excellent/good/fair/poor） |
| `score.height` | 见文件 | 分辨率加分（1080p=60 / 720p=38 …） |
| `score.ipv6Bonus` | `42` | IPv6 运营商源加分 |
| `port` | `3000` | 服务端口（也可用环境变量 `PORT`） |

### 想调「更偏向清晰度」还是「更偏向速度」

改 `score.height` 与 `score.kbps` 即可。例如：

- **网络一般，优先流畅**：把 `kbps.excellent` 调到 `4000`、`kbps.good` 调到 `2000`，让更多源进入高档
- **网络很好，优先画质**：把 `height.h1080` 从 `60` 提到 `90`，分辨率权重就会压过带宽

## 打分公式

```
总分 = 带宽分(0~100) + 分辨率分(0~60) − 延迟惩罚(0~15) + IPv6加分(42) − 各项扣分

带宽分：>=8Mbps→100  >=4Mbps→80  >=2.5Mbps→55  >=1.2Mbps→25  其余→0
分辨率：1080p→60     720p→38     576p→20        其余→8
扣分：  测不出带宽 −20；带宽<1.2Mbps 额外 −34；无音轨 −18

等级：>=130 优   >=95 良   >=60 中   其余 差
```

> 「带宽<1.2Mbps 额外扣 34 分」这条叫**地板惩罚**：这类源无论标称多少分辨率都看不了，
> 此时分辨率加分反而是误导，所以要把它稳稳压到列表末尾。

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
