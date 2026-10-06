'use strict';
/**
 * updater.js —— 更新编排：抓取 → 校验 → 优选 → 写盘 → 日志
 * 可通过 `npm run update` 单独执行，也由 scheduler / API 调用。
 */
const fs = require('fs');
const path = require('path');
const CONFIG = require('./config');
const { fetchAllPools } = require('./fetcher');
const { validateAll } = require('./validator');

function ensureDataDir() {
  fs.mkdirSync(CONFIG.paths.dataDir, { recursive: true });
}

/** 读取上一次的 sources.json（用于旧源兜底） */
function loadPrevious() {
  try {
    const raw = fs.readFileSync(CONFIG.paths.sourcesJson, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

/** 分辨率评分：用于排序优选 */
function scoreOf(s) {
  const px = (s.width || 0) * (s.height || 0);
  // 分辨率优先，其次延迟低优先
  return px - (s.latencyMs || 0);
}

/** 北京时间字符串 */
function beijingTime(d = new Date()) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).format(d).replace(/\//g, '-');
}

/** 生成 m3u 文本 */
function buildM3u(channels) {
  const lines = ['#EXTM3U x-tvg-url=""'];
  for (const ch of channels) {
    for (let i = 0; i < ch.sources.length; i++) {
      const s = ch.sources[i];
      const label = i === 0 ? ch.id : `${ch.id}-线路${i + 1}`;
      const res = s.height ? `${s.height}p` : '';
      lines.push(
        `#EXTINF:-1 tvg-id="${ch.id}" tvg-name="${ch.id}" ` +
        `tvg-logo="" group-title="央视频道",${label}${res ? ' (' + res + ')' : ''}`
      );
      if (s.stale) lines.push(`# 注意：本条为上次更新的缓存源`);
      lines.push(s.url);
    }
  }
  return lines.join('\n') + '\n';
}

/**
 * 执行一次完整更新
 * @param {{onProgress?:Function, silent?:boolean}} opts
 */
async function runUpdate(opts = {}) {
  const log = opts.silent ? () => {} : (...a) => console.log(...a);
  const startedAt = Date.now();
  ensureDataDir();
  const previous = loadPrevious();

  // 1) 抓取
  log('[1/4] 抓取源池...');
  const { candidates, poolStats, total } = await fetchAllPools();
  poolStats.forEach((p) =>
    log(`      ${p.ok ? '✓' : '✗'} ${p.name}: 解析 ${p.parsed} 条，新增 ${p.added} 条${p.error ? ' (' + p.error + ')' : ''}`)
  );
  log(`      候选源合计：${total} 条`);

  // 2) 校验
  const flat = [];
  for (const chId of Object.keys(candidates)) {
    for (const url of candidates[chId]) flat.push({ channel: chId, url });
  }
  log(`[2/4] 校验 ${flat.length} 条源（并发 ${CONFIG.probeConcurrency}）...`);
  const validated = await validateAll(flat, (done, tot) => {
    if (done % 20 === 0 || done === tot) log(`      进度 ${done}/${tot}`);
  });
  const alive = validated.filter((v) => v.ok);
  log(`      校验完成：可用 ${alive.length} / ${flat.length}`);

  // 3) 优选 + 兜底
  log('[3/4] 按频道优选...');
  const channels = [];
  let covered = 0;
  let staleUsed = 0;

  for (const meta of CONFIG.CHANNELS) {
    const list = alive
      .filter((v) => v.channel === meta.id)
      .sort((a, b) => scoreOf(b) - scoreOf(a))
      .slice(0, CONFIG.maxSourcesPerChannel)
      .map((v) => ({
        url: v.url,
        width: v.width,
        height: v.height,
        codec: v.codec,
        latencyMs: v.latencyMs,
        stale: false,
      }));

    let stale = false;
    if (list.length === 0 && previous) {
      // 兜底：沿用上一轮该频道的旧源，标记 stale
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
  log(`      频道覆盖：${covered}/${CONFIG.CHANNELS.length}${staleUsed ? `（其中 ${staleUsed} 个频道沿用了旧源）` : ''}`);

  // 4) 写盘
  log('[4/4] 写入文件...');
  const updatedAt = new Date().toISOString();
  const totalAlive = channels.reduce((s, c) => s + c.sources.length, 0);
  const output = {
    updatedAt,
    updatedAtBeijing: beijingTime(new Date(updatedAt)),
    nextRunCron: CONFIG.cronExpression,
    nextRunTimeZone: CONFIG.cronTimeZone,
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

  fs.writeFileSync(CONFIG.paths.sourcesJson, JSON.stringify(output, null, 2), 'utf8');
  fs.writeFileSync(CONFIG.paths.sourcesM3u, buildM3u(channels), 'utf8');

  // 历史日志
  const line =
    `[${beijingTime()}] 候选 ${total} / 可用 ${alive.length} / 发布 ${totalAlive} / ` +
    `覆盖 ${covered}/${CONFIG.CHANNELS.length} / 耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s\n`;
  fs.appendFileSync(CONFIG.paths.historyLog, line, 'utf8');

  log(`✓ 更新完成：发布 ${totalAlive} 条源，覆盖 ${covered}/${CONFIG.CHANNELS.length} 频道，耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  return output;
}

module.exports = { runUpdate, beijingTime, buildM3u };

// 允许 `node src/updater.js` 直接执行
if (require.main === module) {
  runUpdate().catch((e) => {
    console.error('更新失败：', e);
    process.exit(1);
  });
}
