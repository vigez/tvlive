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
  // 兼容 CCTV5+ / CCTV-5+ / CCTV5PLUS / CCTV5PUL 等写法
  n = n.replace(/PLUS|PUL/g, '+');
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

/**
 * 清理 URL：源池里常混入「备注文字」，例如
 *   http://tvbox6.icu/tv/migu.php?id=cctv5p$LR•IPV4『线路72』
 * 尾部的 `$LR•...` 是标注，不是 URL 的一部分，直接发给播放器会 404。
 */
function cleanUrl(raw) {
  if (!raw) return null;
  let u = String(raw).trim();
  // 去掉 $ 及其后的备注（iptv 生态常见写法）
  const dollar = u.indexOf('$');
  if (dollar > 0) u = u.slice(0, dollar);
  // 去掉全角/特殊标注
  u = u.replace(/[$「」『』•]/g, '');
  return u.trim();
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
      const url = cleanUrl(line);
      if (ch && url && /^https?:\/\//i.test(url)) out.push({ channel: ch, url });
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
 * 判定 URL 是否为 IPv6 直连地址（形如 http://[2409:8087::1]/...）
 * 注意：IPv6 域名（如 ipv6.xxx.com）不算 —— 那种本机同样能解析。
 */
function isIpv6Literal(url) {
  return /^https?:\/\/\[/i.test(url || '');
}

/**
 * 抓取全部源池并聚合。
 *
 * 排序优先级：IPv4 源排在 IPv6 源之前。
 * 原因：本机（多数构建机）没有 IPv6 出口，IPv6 源无法验证快慢。
 * 若让 IPv6 源占据候选列表前部，会挤掉后面能实测的 IPv4 源。
 *
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
        let addedV6 = 0;
        for (const it of items) {
          const list = candidates[it.channel];
          if (!list) continue;
          if (list.includes(it.url)) continue;
          if (isIpv6Literal(it.url)) {
            // IPv6 源限量收录：它们是「同运营商内网」的宝，但本机测不了速，
            // 给太多会稀释榜单。每频道最多补 3 条。
            const v6Count = list.filter(isIpv6Literal).length;
            if (v6Count >= (CONFIG.maxIpv6PerChannel ?? 3)) continue;
            addedV6++;
          }
          list.push(it.url);
          added++;
        }
        if (added === 0) { lastErr = '无新增央视源'; continue; }
        return { name: pool.name, ok: true, parsed: items.length, added, addedV6, via: u };
      } catch (e) {
        lastErr = String(e.message || e);
      }
    }
    return { name: pool.name, ok: false, parsed: 0, added: 0, error: lastErr || '全部地址失败' };
  });

  const results = await Promise.all(tasks);
  poolStats.push(...results);

  // 关键：每个频道的候选里，IPv4 排前、IPv6 排后。
  // 这样即使校验阶段有数量截断，被截掉的也是「验不了的 IPv6」而不是「能验的 IPv4」。
  for (const chId of Object.keys(candidates)) {
    const list = candidates[chId];
    const v4 = list.filter((u) => !isIpv6Literal(u));
    const v6 = list.filter(isIpv6Literal);
    candidates[chId] = [...v4, ...v6];
  }

  const total = Object.values(candidates).reduce((s, v) => s + v.length, 0);
  return { candidates, poolStats, total };
}

module.exports = { fetchAllPools, parseM3u, normalizeChannelName, cleanUrl, fetchText, isIpv6Literal };
