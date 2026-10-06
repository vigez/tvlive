'use strict';
/**
 * validator.js —— 用 ffprobe 并发探测直播源是否真的能播
 * 返回：{ ok, width, height, codec, latencyMs } 或 { ok:false, reason }
 */
const { spawn } = require('child_process');
const CONFIG = require('./config');

/** 探测单条源 */
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
        const v = (data.streams || []).find((s) => s.codec_type === 'video');
        if (!v) return finish({ ok: false, reason: 'no-video' });
        finish({
          ok: true,
          width: v.width || 0,
          height: v.height || 0,
          codec: v.codec_name || '',
          latencyMs: Date.now() - start,
        });
      } catch (_) {
        finish({ ok: false, reason: 'parse-failed' });
      }
    });
  });
}

/** 带重试的探测 */
async function probe(url) {
  for (let i = 0; i <= CONFIG.probeRetries; i++) {
    const r = await probeOnce(url);
    if (r.ok) return r;
  }
  return { ok: false, reason: 'unreachable' };
}

/**
 * 并发探测一组 {channel, url} 条目
 * @param {Array<{channel:string,url:string}>} items
 * @param {(done:number,total:number)=>void} [onProgress]
 */
async function validateAll(items, onProgress) {
  const results = [];
  let done = 0;
  let cursor = 0;
  const total = items.length;

  async function worker() {
    while (cursor < total) {
      const idx = cursor++;
      const it = items[idx];
      const r = await probe(it.url);
      results[idx] = { ...it, ...r };
      done++;
      if (onProgress) onProgress(done, total);
    }
  }

  const n = Math.min(CONFIG.probeConcurrency, total) || 1;
  await Promise.all(Array.from({ length: n }, worker));
  return results;
}

module.exports = { probe, validateAll };
