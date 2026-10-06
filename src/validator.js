'use strict';
/**
 * validator.js —— 用 ffprobe + 分片实拉 双重探测直播源
 *
 * 为什么不能只靠 ffprobe：
 *   ffprobe 只证明「能解析出视频流」，不证明「拉得动」。
 *   实测同一批源里，境外小机房的源能解析出 1080p，但实测带宽只有 2 Mbps，
 *   而境内广电 CDN 的源有 60+ Mbps。两者都是「可用」，但体验差 30 倍。
 *
 * 所以本模块做两件事：
 *   1) ffprobe   —— 确认能播、拿到分辨率/编码
 *   2) 分片实拉   —— 连续下载若干分片，量出**真实带宽**
 * 排序时以真实带宽为主，分辨率次之。
 */

const { spawn } = require('child_process');
const CONFIG = require('./config');

/* ------------------------------------------------------------------ */
/* 1) ffprobe：确认可播 + 元信息                                        */
/* ------------------------------------------------------------------ */

/** 探测单条源（ffprobe） */
function probeOnce(url) {
  return new Promise((resolve) => {
    const start = Date.now();
    const args = [
      '-v', 'quiet',
      '-rw_timeout', String(CONFIG.probeRwTimeoutMs),
      '-show_entries', 'stream=codec_type,codec_name,width,height',
      '-of', 'json',
      '-analyzeduration', '4000000',
      '-probesize', '4000000',
      url,
    ];
    let out = '';
    let settled = false;
    const finish = (r) => { if (!settled) { settled = true; resolve(r); } };

    let proc;
    try {
      proc = spawn('ffprobe', args, { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (e) {
      return finish({ ok: false, reason: 'spawn-failed' });
    }

    const killer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch (_) {}
      finish({ ok: false, reason: 'timeout' });
    }, CONFIG.probeTimeoutMs);

    proc.stdout.on('data', (d) => (out += d.toString()));
    proc.on('error', () => { clearTimeout(killer); finish({ ok: false, reason: 'ffprobe-missing' }); });
    proc.on('close', (code) => {
      clearTimeout(killer);
      if (code !== 0 || !out.trim()) return finish({ ok: false, reason: 'no-stream' });
      try {
        const data = JSON.parse(out);
        const streams = data.streams || [];
        const v = streams.find((s) => s.codec_type === 'video');
        if (!v) return finish({ ok: false, reason: 'no-video' });
        const a = streams.find((s) => s.codec_type === 'audio');
        finish({
          ok: true,
          width: v.width || 0,
          height: v.height || 0,
          codec: v.codec_name || '',
          audioCodec: a ? a.codec_name || '' : '',
          // 有视频没音频的源要警惕（老设备播起来会「哑巴」）
          hasAudio: !!a,
          latencyMs: Date.now() - start,
        });
      } catch (_) {
        finish({ ok: false, reason: 'parse-failed' });
      }
    });
  });
}

/** 带重试的 ffprobe */
async function probe(url) {
  for (let i = 0; i <= CONFIG.probeRetries; i++) {
    const r = await probeOnce(url);
    if (r.ok) return r;
  }
  return { ok: false, reason: 'unreachable' };
}

/* ------------------------------------------------------------------ */
/* 2) 分片实拉：量真实带宽                                             */
/* ------------------------------------------------------------------ */

/** curl 极简封装：返回 { code, bytes, seconds, body } */
function curl(args, timeoutMs) {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn('curl', args, { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (_) {
      return resolve({ code: -1, bytes: 0, seconds: 0, body: '' });
    }
    let body = '';
    let settled = false;
    const finish = (r) => { if (!settled) { settled = true; resolve(r); } };
    const killer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch (_) {}
      finish({ code: -1, bytes: 0, seconds: 0, body });
    }, timeoutMs);

    proc.stdout.on('data', (d) => (body += d.toString()));
    proc.on('error', () => { clearTimeout(killer); finish({ code: -1, bytes: 0, seconds: 0, body }); });
    proc.on('close', () => { clearTimeout(killer); finish({ code: 0, bytes: 0, seconds: 0, body }); });
  });
}

/** 取 m3u8 文本和「跳转后的最终地址」 */
async function fetchPlaylist(url) {
  const r = await curl(
    ['-sL', '--max-time', '12', '-A', CONFIG.userAgent || 'CCTV-Live-Updater/1.0', url],
    14000
  );
  return r.body || '';
}

/** 取最终重定向地址（用于拼相对分片路径） */
async function resolveFinalUrl(url) {
  const r = await curl(
    ['-sIL', '--max-time', '8', '-A', CONFIG.userAgent || 'CCTV-Live-Updater/1.0',
     '-o', '/dev/null', '-w', '%{url_effective}', url],
    10000
  );
  return (r.body || '').trim();
}

/**
 * 实测真实带宽：连续下载若干分片，累加字节数 / 累加耗时。
 *
 * 注意不要用「单个大分片的首包速度」来估算 —— 分片小的源会被严重低估，
 * 实测中河北广电 2.7MB 的首片初次耗时含 TCP 慢启动，会算出 57kbps 的假值，
 * 而连续拉 6 秒实测是 62Mbps。所以必须连续拉、按总耗时算。
 */
async function measureBandwidth(url) {
  const playlist = await fetchPlaylist(url);
  const segs = playlist
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  if (segs.length === 0) return { ok: false, reason: 'no-segment' };

  let base;
  if (/^https?:\/\//i.test(segs[0])) {
    base = segs[0].replace(/\/[^/]*$/, '');   // 分片已是绝对地址
  } else {
    const finalUrl = (await resolveFinalUrl(url)) || url;
    // 相对路径必须基于「重定向后的地址」解析，否则会 404
    base = finalUrl.replace(/\/[^/]*$/, '');
  }

  const want = CONFIG.bandwidthSampleCount || 5;
  const budgetMs = CONFIG.bandwidthBudgetMs || 6000;
  const startedAt = Date.now();

  let totalBytes = 0;
  let totalSec = 0;
  let chunks = 0;

  for (const seg of segs.slice(0, want)) {
    if (Date.now() - startedAt > budgetMs) break;
    const full = /^https?:\/\//i.test(seg) ? seg : base + '/' + seg;
    const t0 = Date.now();
    const r = await curl(
      ['-s', '--max-time', '6', '-A', CONFIG.userAgent || 'CCTV-Live-Updater/1.0',
       '-o', '/dev/null', '-w', '%{size_download}', full],
      7000
    );
    const dt = (Date.now() - t0) / 1000;
    const n = parseInt(r.body, 10);
    if (!isNaN(n) && n > 0) {
      totalBytes += n;
      totalSec += dt;
      chunks++;
    }
  }

  if (chunks === 0 || totalSec <= 0) return { ok: false, reason: 'no-data' };

  // kbps = 字节 * 8 / 千 / 秒
  const kbps = (totalBytes * 8) / 1000 / totalSec;
  return {
    ok: true,
    kbps: Math.round(kbps),
    bytesMb: +(totalBytes / 1024 / 1024).toFixed(2),
    seconds: +totalSec.toFixed(2),
    chunks,
  };
}

/**
 * 综合探测一条源：先 ffprobe 确认可播，再实测带宽。
 *
 * IPv6 源的处理：不做「无条件放行」。本机如果没有 IPv6 出口就测不了，
 * 但要尝试真实探测 —— 探得动就按正常流程走，探不动才标记为 ipv6 并降权。
 * 早期版本对所有 IPv6 源直接判定 ok，导致大量无法验证的源挤掉能测速的 IPv4 源。
 *
 * @returns {Promise<{ok:boolean,width?:number,height?:number,codec?:string,kbps?:number,...}>}
 */
async function inspect(url) {
  const isIpv6 = /^https?:\/\/\[/i.test(url);

  const p = await probe(url);

  // IPv6 源本机探不动：不判死，但要明确标记，交给打分环节降权
  if (!p.ok && isIpv6) {
    return {
      ok: true,
      width: 0,
      height: 0,
      codec: 'h264',
      latencyMs: 0,
      kbps: 0,
      isIpv6: true,
      ipv6Unverified: true,
      bwChunks: 0,
      bwBytesMb: 0,
      hasAudio: true,
    };
  }
  if (!p.ok) return { ok: false, reason: p.reason };

  let bw = { ok: false };
  try {
    bw = await measureBandwidth(url);
  } catch (_) {
    bw = { ok: false };
  }

  return {
    ok: true,
    width: p.width,
    height: p.height,
    codec: p.codec,
    audioCodec: p.audioCodec || '',
    hasAudio: p.hasAudio !== false,
    latencyMs: p.latencyMs,
    // 带宽测不出时给 0，排序会落到后面，但不会因此被剔除
    kbps: bw.ok ? bw.kbps : 0,
    isIpv6,
    bwChunks: bw.ok ? bw.chunks : 0,
    bwBytesMb: bw.ok ? bw.bytesMb : 0,
  };
}

/* ------------------------------------------------------------------ */
/* 3) 并发调度                                                         */
/* ------------------------------------------------------------------ */

async function inspectAll(items, onProgress) {
  const results = [];
  let done = 0;
  let cursor = 0;
  const total = items.length;

  async function worker() {
    while (cursor < total) {
      const idx = cursor++;
      const it = items[idx];
      const r = await inspect(it.url);
      results[idx] = { ...it, ...r };
      done++;
      if (onProgress) onProgress(done, total);
    }
  }

  const n = Math.min(CONFIG.probeConcurrency, total) || 1;
  await Promise.all(Array.from({ length: n }, worker));
  return results;
}

/** 兼容旧接口：只做 ffprobe，不做带宽 */
async function validateAll(items, onProgress) {
  const results = [];
  let done = 0;
  let cursor = 0;
  const total = items.length;
  async function worker() {
    while (cursor < total) {
      const idx = cursor++;
      const r = await probe(items[idx].url);
      results[idx] = { ...items[idx], ...r };
      done++;
      if (onProgress) onProgress(done, total);
    }
  }
  const n = Math.min(CONFIG.probeConcurrency, total) || 1;
  await Promise.all(Array.from({ length: n }, worker));
  return results;
}

module.exports = { probe, probeOnce, validateAll, inspect, inspectAll, measureBandwidth };
