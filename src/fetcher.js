'use strict';
/**
 * fetcher.js —— 多源池抓取 + m3u 解析 + 按频道聚合去重
 */
const CONFIG = require('./config');

/** 频道名归一化：把各种写法统一成 CCTV-1 / CCTV-5+ 形式 */
function normalizeChannelName(raw) {
  if (!raw) return null;
  let n = String(raw).toUpperCase();
  n = n.replace(/[（(][^）)]*[）)]/g, ' ');   // 去掉括号补充说明
  n = n.replace(/[\s_]+/g, '');              // 去掉空格和下划线
  const m = n.match(/CCTV-?(\d{1,2})(\+)?/); // 同时兼容 CCTV1 / CCTV-1 / CCTV5+
  if (!m) return null;
  const id = 'CCTV-' + m[1] + (m[2] || '');
  return CONFIG.CHANNELS.some((c) => c.id === id) ? id : null;
}

/** 从 #EXTINF 行里尽量提取频道名 */
function channelNameFromExtinf(line) {
  // 优先取逗号后的显示名
  const idx = line.lastIndexOf(',');
  if (idx !== -1) {
    const tail = line.slice(idx + 1).trim();
    if (tail) return tail;
  }
  const m = line.match(/tvg-name="([^"]+)"/i) || line.match(/tvg-id="([^"]+)"/i);
  return m ? m[1] : null;
}

/** 解析一份 m3u 文本，返回 [{channel, url}] */
function parseM3u(text) {
  const out = [];
  if (!text) return out;
  const lines = text.split(/\r?\n/);
  let pending = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF')) {
      pending = channelNameFromExtinf(line);
    } else if (line.startsWith('#')) {
      // 其他指令（如 #EXTVLCOPT）忽略，但保留 pending
    } else if (/^https?:\/\//i.test(line)) {
      const ch = normalizeChannelName(pending);
      if (ch) out.push({ channel: ch, url: line });
      pending = null;
    }
  }
  return out;
}

/** 简单带超时的 fetch（Node 18+ 原生 fetch） */
async function fetchText(url, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (CCTV-Live-Updater/1.0)' },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 抓取全部源池并聚合。
 * @returns {Promise<{candidates: Object<string,string[]>, poolStats: Array}>}
 */
async function fetchAllPools() {
  const candidates = {};
  CONFIG.CHANNELS.forEach((c) => (candidates[c.id] = []));
  const poolStats = [];

  const tasks = CONFIG.SOURCE_POOLS.map(async (pool) => {
    const urls = [pool.url, ...(pool.mirrors || [])];
    let lastErr = null;
    for (const u of urls) {
      try {
        const text = await fetchText(u, CONFIG.fetchTimeoutMs);
        const items = parseM3u(text);
        if (items.length === 0) { lastErr = '解析结果为空'; continue; }
        let added = 0;
        for (const it of items) {
          const list = candidates[it.channel];
          if (list && !list.includes(it.url)) {
            list.push(it.url);
            added++;
          }
        }
        if (added === 0) { lastErr = '无新增央视源'; continue; }
        return { name: pool.name, ok: true, parsed: items.length, added, via: u };
      } catch (e) {
        lastErr = String(e.message || e);
      }
    }
    return { name: pool.name, ok: false, parsed: 0, added: 0, error: lastErr || '全部地址失败' };
  });

  const results = await Promise.all(tasks);
  poolStats.push(...results);

  const total = Object.values(candidates).reduce((s, v) => s + v.length, 0);
  return { candidates, poolStats, total };
}

module.exports = { fetchAllPools, parseM3u, normalizeChannelName, fetchText };
