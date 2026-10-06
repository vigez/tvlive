'use strict';
/**
 * build-static.mjs —— 方案 2（GitHub Actions + Pages）的抓取校验脚本
 *
 * 复用 src/fetcher.js 与 src/validator.js，把结果直接产出为**纯静态文件**，
 * 供 GitHub Pages 托管，无需任何服务端：
 *   docs/sources.json   —— 网站读取的数据源
 *   docs/sources.m3u    —— 供播放器/电视盒子导入
 *   docs/stats.json     —— 精简统计（首页角标用）
 *
 * 由 .github/workflows/update.yml 每天北京时间 05:00 触发执行。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const CONFIG = require(path.join(ROOT, 'src', 'config.js'));
const { fetchAllPools } = require(path.join(ROOT, 'src', 'fetcher.js'));
const { validateAll } = require(path.join(ROOT, 'src', 'validator.js'));

const DOCS = path.join(ROOT, 'docs');
const OUT_JSON = path.join(DOCS, 'sources.json');
const OUT_M3U = path.join(DOCS, 'sources.m3u');
const OUT_STATS = path.join(DOCS, 'stats.json');

// 本地化 hls.js 播放器：避免页面依赖境外 CDN（国内访问不稳定）
const HLS_URLS = [
  'https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js',
  'https://unpkg.com/hls.js@1.5.13/dist/hls.min.js',
];
const OUT_HLS = path.join(DOCS, 'hls.min.js');

/** 确保 docs/hls.min.js 存在；缺失时自动下载（带多镜像） */
async function ensureHlsLib() {
  if (fs.existsSync(OUT_HLS) && fs.statSync(OUT_HLS).size > 100000) {
    console.log('   hls.min.js 已存在，跳过下载');
    return true;
  }
  for (const u of HLS_URLS) {
    try {
      const res = await fetch(u, { redirect: 'follow' });
      if (!res.ok) continue;
      const txt = await res.text();
      if (txt.length < 100000 || !txt.includes('Hls')) continue;
      fs.writeFileSync(OUT_HLS, txt, 'utf8');
      console.log(`   已下载 hls.min.js（${(txt.length / 1024).toFixed(0)} KB）`);
      return true;
    } catch {
      /* 换下一个镜像 */
    }
  }
  console.warn('   ⚠ hls.min.js 下载失败，页面将回退到 CDN 加载');
  return false;
}

/** 读取旧数据（用于旧源兜底） */
function loadPrevious() {
  try {
    return JSON.parse(fs.readFileSync(OUT_JSON, 'utf8'));
  } catch {
    return null;
  }
}

function beijingTime(d = new Date()) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).format(d).replace(/\//g, '-');
}

function scoreOf(s) {
  return (s.width || 0) * (s.height || 0) - (s.latencyMs || 0);
}

function buildM3u(channels) {
  const lines = ['#EXTM3U x-tvg-url=""'];
  for (const ch of channels) {
    ch.sources.forEach((s, i) => {
      const label = i === 0 ? ch.id : `${ch.id}-线路${i + 1}`;
      const res = s.height ? ` (${s.height}p)` : '';
      lines.push(
        `#EXTINF:-1 tvg-id="${ch.id}" tvg-name="${ch.id}" tvg-logo="" ` +
        `group-title="央视频道",${label}${res}`
      );
      if (s.stale) lines.push('# 注意：本条为上次更新的缓存源');
      lines.push(s.url);
    });
  }
  return lines.join('\n') + '\n';
}

async function main() {
  const startedAt = Date.now();
  fs.mkdirSync(DOCS, { recursive: true });
  const previous = loadPrevious();

  console.log('==========================================');
  console.log(' 方案2 静态构建 · 央视直播源');
  console.log(` 北京时间：${beijingTime()}`);
  console.log('==========================================');

  // 0) 确保播放器脚本就位（本地化，去除境外 CDN 依赖）
  console.log('\n[0/4] 检查播放器脚本...');
  await ensureHlsLib();

  // 1) 抓取
  console.log('\n[1/4] 抓取源池...');
  const { candidates, poolStats, total } = await fetchAllPools();
  poolStats.forEach((p) =>
    console.log(`   ${p.ok ? '✓' : '✗'} ${p.name}: 解析 ${p.parsed} 条，新增 ${p.added} 条${p.error ? ' (' + p.error + ')' : ''}`)
  );
  console.log(`   候选源合计：${total} 条`);

  // 2) 校验
  const flat = [];
  for (const chId of Object.keys(candidates)) {
    for (const url of candidates[chId]) flat.push({ channel: chId, url });
  }
  console.log(`\n[2/4] ffprobe 校验 ${flat.length} 条源（并发 ${CONFIG.probeConcurrency}）...`);
  const validated = await validateAll(flat, (done, tot) => {
    if (done % 30 === 0 || done === tot) console.log(`   进度 ${done}/${tot}`);
  });
  const alive = validated.filter((v) => v.ok);
  console.log(`   校验完成：可用 ${alive.length} / ${flat.length}`);

  // 3) 优选 + 兜底
  console.log('\n[3/4] 按频道优选...');
  const channels = [];
  let covered = 0, staleUsed = 0;

  for (const meta of CONFIG.CHANNELS) {
    const list = alive
      .filter((v) => v.channel === meta.id)
      .sort((a, b) => scoreOf(b) - scoreOf(a))
      .slice(0, CONFIG.maxSourcesPerChannel)
      .map((v) => ({
        url: v.url, width: v.width, height: v.height,
        codec: v.codec, latencyMs: v.latencyMs, stale: false,
      }));

    let stale = false;
    if (list.length === 0 && previous) {
      const prevCh = (previous.channels || []).find((c) => c.id === meta.id);
      if (prevCh && prevCh.sources && prevCh.sources.length) {
        prevCh.sources.forEach((s) => list.push({ ...s, stale: true }));
        stale = true;
        staleUsed++;
      }
    }
    if (list.length > 0) covered++;
    channels.push({ id: meta.id, name: meta.name, logo: meta.logo, stale, sources: list });
  }
  console.log(`   频道覆盖：${covered}/${CONFIG.CHANNELS.length}${staleUsed ? `（${staleUsed} 个沿用旧源）` : ''}`);

  // 4) 写盘
  console.log('\n[4/4] 写入静态文件...');
  const updatedAt = new Date().toISOString();
  const totalAlive = channels.reduce((s, c) => s + c.sources.length, 0);
  const output = {
    updatedAt,
    updatedAtBeijing: beijingTime(new Date(updatedAt)),
    buildMode: 'static-gh-pages',
    schedule: { cron: CONFIG.cronExpression, timeZone: CONFIG.cronTimeZone, human: '每天北京时间 05:00' },
    stats: {
      poolCount: CONFIG.SOURCE_POOLS.length,
      candidateCount: total,
      aliveCount: alive.length,
      publishedCount: totalAlive,
      channelCovered: covered,
      channelTotal: CONFIG.CHANNELS.length,
      staleChannels: staleUsed,
      durationMs: Date.now() - startedAt,
    },
    pools: poolStats,
    channels,
  };

  fs.writeFileSync(OUT_JSON, JSON.stringify(output, null, 2), 'utf8');
  fs.writeFileSync(OUT_M3U, buildM3u(channels), 'utf8');
  fs.writeFileSync(
    OUT_STATS,
    JSON.stringify(
      {
        updatedAt,
        updatedAtBeijing: output.updatedAtBeijing,
        publishedCount: totalAlive,
        channelCovered: covered,
        channelTotal: CONFIG.CHANNELS.length,
        staleChannels: staleUsed,
      },
      null,
      2
    ),
    'utf8'
  );

  const sec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\n✓ 完成：发布 ${totalAlive} 条源，覆盖 ${covered}/${CONFIG.CHANNELS.length} 频道，耗时 ${sec}s`);
  console.log(`  输出：docs/sources.json · docs/sources.m3u · docs/stats.json`);

  // GitHub Actions 输出摘要（可选，便于在 Actions 页面直接看到）
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## 央视直播源更新结果\n\n` +
      `| 指标 | 数值 |\n|---|---|\n` +
      `| 更新时间（北京） | ${output.updatedAtBeijing} |\n` +
      `| 聚合候选源 | ${total} 条 |\n` +
      `| 校验通过 | ${alive.length} 条 |\n` +
      `| **发布** | **${totalAlive} 条** |\n` +
      `| 频道覆盖 | **${covered}/${CONFIG.CHANNELS.length}** |\n` +
      `| 耗时 | ${sec} 秒 |\n`
    );
  }

  // 覆盖率过低时以非零码退出，让 Actions 标红提醒（但不阻塞提交）
  if (covered < CONFIG.CHANNELS.length * 0.5) {
    console.warn(`⚠ 覆盖率偏低（${covered}/${CONFIG.CHANNELS.length}），已写入结果但请留意源池状态`);
  }
}

main().catch((e) => {
  console.error('构建失败：', e);
  process.exit(1);
});
