'use strict';
/**
 * server.js —— Express 服务：静态站点 + API + 定时任务
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const CONFIG = require('./src/config');
const scheduler = require('./src/scheduler');
const { beijingTime } = require('./src/updater');
const { fetchAllPools, fetchText } = require('./src/fetcher');
const { probe } = require('./src/validator');

const app = express();
app.use(express.json());

// ---------- 静态资源 ----------
app.use(express.static(CONFIG.paths.publicDir, { extensions: ['html'] }));

// ---------- 数据读取辅助 ----------
function readSources() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG.paths.sourcesJson, 'utf8'));
  } catch (_) {
    return {
      updatedAt: null,
      updatedAtBeijing: '尚未生成',
      channels: CONFIG.CHANNELS.map((c) => ({ ...c, stale: false, sources: [] })),
      stats: { candidateCount: 0, aliveCount: 0, publishedCount: 0, channelCovered: 0, channelTotal: CONFIG.CHANNELS.length },
    };
  }
}

// ---------- API ----------
// 全部频道与可用源
app.get('/api/channels', (req, res) => {
  res.json(readSources());
});

// 状态
app.get('/api/status', (req, res) => {
  const data = readSources();
  res.json({
    updatedAt: data.updatedAt,
    updatedAtBeijing: data.updatedAtBeijing,
    nowBeijing: beijingTime(),
    schedule: { cron: CONFIG.cronExpression, timeZone: CONFIG.cronTimeZone },
    stats: data.stats,
    updater: scheduler.status(),
  });
});

// 下载 / 获取 m3u
app.get('/api/playlist.m3u', (req, res) => {
  try {
    const m3u = fs.readFileSync(CONFIG.paths.sourcesM3u, 'utf8');
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
    if (req.query.download !== undefined) {
      res.setHeader('Content-Disposition', 'attachment; filename="cctv-live.m3u"');
    }
    res.send(m3u);
  } catch (_) {
    res.status(404).send('#EXTM3U\n# 尚未生成源列表，请先执行更新\n');
  }
});

// 手动触发更新
app.get('/api/update', async (req, res) => {
  if (req.query.token && process.env.UPDATE_TOKEN && req.query.token !== process.env.UPDATE_TOKEN) {
    return res.status(403).json({ error: 'token 无效' });
  }
  const r = await scheduler.trigger('手动触发');
  res.json({ ok: !r.error, result: r });
});

// 诊断：查看当前源池聚合情况（不写盘）
app.get('/api/diagnose', async (req, res) => {
  const { poolStats, total } = await fetchAllPools();
  res.json({ poolStats, totalCandidates: total });
});

// 代理探测：用于前端「测试此线路」
app.get('/api/probe', async (req, res) => {
  const url = req.query.url;
  if (!url || !/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'url 无效' });
  const r = await probe(url);
  res.json(r);
});

// 反向代理播放（用于浏览器直连受限的源）
app.get('/api/relay', async (req, res) => {
  const url = req.query.url;
  if (!url || !/^https?:\/\//i.test(url)) return res.status(400).send('url 无效');
  try {
    const upstream = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: new URL(url).origin },
      redirect: 'follow',
    });
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/vnd.apple.mpegurl');
    res.setHeader('Access-Control-Allow-Origin', '*');
    const text = await upstream.text();
    // 简单重写 m3u8 内的分片地址为绝对地址（若为相对路径）
    if (/mpegurl/i.test(res.getHeader('Content-Type') || '')) {
      const base = new URL(url);
      const rewritten = text
        .split(/\r?\n/)
        .map((l) => {
          const t = l.trim();
          if (!t || t.startsWith('#')) return l;
          try { return new URL(t, base).toString(); } catch (_) { return l; }
        })
        .join('\n');
      return res.send(rewritten);
    }
    res.send(text);
  } catch (e) {
    res.status(502).send('relay 失败: ' + e.message);
  }
});

// 首页兜底
app.get('*', (req, res) => {
  res.sendFile(path.join(CONFIG.paths.publicDir, 'index.html'));
});

// ---------- 启动 ----------
if (require.main === module) {
  app.listen(CONFIG.port, () => {
    console.log('==================================================');
    console.log('  央视直播源自动更新网站已启动');
    console.log(`  地址：http://localhost:${CONFIG.port}`);
    console.log(`  数据更新时间：${readSources().updatedAtBeijing}`);
    console.log(`  北京时间：${beijingTime()}`);
    console.log('==================================================');
    try {
      scheduler.start();
    } catch (e) {
      console.error('定时任务启动失败：', e.message);
    }
    // 若尚无数据，启动后自动跑一次（不阻塞服务）
    if (!readSources().updatedAt) {
      console.log('[启动] 检测到尚无源数据，后台自动执行首次更新...');
      scheduler.trigger('首次启动').catch(() => {});
    }
  });
}

module.exports = app;
