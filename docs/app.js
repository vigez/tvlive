'use strict';
/* 央视直播源 · 静态版前端逻辑（GitHub Pages）
 * 与方案1的区别：没有服务端，直接读取同目录下的 sources.json / sources.m3u
 */

let DATA = null;
let current = { channelId: null, lineIndex: 0 };
let hls = null;
// 是否具备服务端代理能力（Cloudflare Pages Functions）。
// 有代理时可绕过直播源的跨域限制，网页内可播频道从 4/18 提升到接近全部。
let RELAY_AVAILABLE = false;

const $ = (s) => document.querySelector(s);
const video = $('#video');
const overlay = $('#player-overlay');
const grid = $('#grid');
const lineSwitch = $('#line-switch');
const nowPlaying = $('#now-playing');
const corsHint = $('#cors-hint');

/* ---------------- 探测代理能力 ---------------- */
async function detectRelay() {
  try {
    const r = await fetch('./relay?url=' + encodeURIComponent('http://example.com/test.m3u8'), {
      method: 'GET',
    });
    // 能收到任何 HTTP 响应（哪怕是 4xx/5xx）都说明 Function 存在
    RELAY_AVAILABLE = r.status !== 404 && r.status !== 405;
  } catch (_) {
    RELAY_AVAILABLE = false;
  }
  if (RELAY_AVAILABLE) {
    corsHint.textContent = '';
  }
}

/** 把源地址包成走代理的地址 */
function proxyUrl(u) {
  if (!RELAY_AVAILABLE) return u;
  return './relay?url=' + encodeURIComponent(u);
}

/* ---------------- 工具 ---------------- */
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2200);
}
function copy(text) {
  const done = () => toast('已复制');
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else {
    fallbackCopy(text, done);
  }
}
function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); done(); } catch (_) { toast('复制失败，请手动复制'); }
  document.body.removeChild(ta);
}
function resLabel(s) {
  if (!s) return '未知';
  if (s.height >= 1080) return '1080P 高清';
  if (s.height >= 720) return '720P 高清';
  if (s.height > 0) return s.height + 'P';
  return '标清/未知';
}

/* ---------------- 渲染 ---------------- */
function renderStatus() {
  const st = DATA.stats || {};
  $('#chip-updated').textContent = '数据更新：' + (DATA.updatedAtBeijing || '未知');
  $('#chip-count').textContent = (st.publishedCount || 0) + ' 条可用源';
  $('#chip-cover').textContent = `覆盖 ${st.channelCovered || 0}/${st.channelTotal || 0} 频道`;
  $('#runtime-meta').innerHTML =
    `候选源：${st.candidateCount || 0} 条 · 校验通过：${st.aliveCount || 0} 条 · 发布：${st.publishedCount || 0} 条<br>` +
    `更新方式：GitHub Actions 定时任务 · 每天 05:00（北京时间）` +
    (st.staleChannels ? ` · <span style="color:#ffcf5c">${st.staleChannels} 个频道沿用缓存源</span>` : '');
  $('#foot-updated').textContent = DATA.updatedAtBeijing || '—';
  // 在统计区标注当前播放模式
  const mode = RELAY_AVAILABLE ? '跨域代理已启用（网页内可播全部频道）' : '直连模式（仅部分源可在网页播放）';
  $('#runtime-meta').innerHTML += `<br>播放模式：${mode}`;
}

function renderGrid() {
  grid.innerHTML = '';
  let withSource = 0;
  DATA.channels.forEach((ch) => {
    const n = ch.sources.length;
    if (n > 0) withSource++;
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.id = ch.id;
    if (current.channelId === ch.id) card.classList.add('active');

    const best = ch.sources[0];
    const badges = [];
    if (n > 0) {
      badges.push(`<span class="badge ok">${n} 条线路</span>`);
      badges.push(`<span class="badge">${resLabel(best)}</span>`);
    } else {
      badges.push(`<span class="badge bad">暂无可用源</span>`);
    }
    if (ch.stale) badges.push(`<span class="badge warn">缓存源</span>`);

    card.innerHTML = `
      <div class="card-head">
        <div class="card-logo">${ch.logo || 'C'}</div>
        <div>
          <div class="card-name">${ch.name}</div>
          <div class="card-sub">${ch.id}</div>
        </div>
      </div>
      <div class="card-badges">${badges.join('')}</div>
      <div class="card-foot">
        <button class="mini act-play" ${n ? '' : 'disabled'}>▶ 播放</button>
        <button class="mini act-copy" ${n ? '' : 'disabled'}>复制源</button>
      </div>`;

    card.addEventListener('click', (e) => {
      if (e.target.classList.contains('act-copy')) {
        copy(ch.sources[0].url);
        return;
      }
      if (n === 0) { toast('该频道暂无可用源'); return; }
      playChannel(ch.id, 0);
    });
    grid.appendChild(card);
  });
  $('#channel-hint').textContent = `共 ${DATA.channels.length} 个频道，${withSource} 个有可用源`;
}

function renderLines() {
  const ch = DATA.channels.find((c) => c.id === current.channelId);
  lineSwitch.innerHTML = '';
  if (!ch || !ch.sources.length) return;
  ch.sources.forEach((s, i) => {
    const b = document.createElement('button');
    b.className = 'line-btn' + (i === current.lineIndex ? ' active' : '');
    b.textContent = `线路${i + 1} · ${resLabel(s)}`;
    b.addEventListener('click', () => playChannel(ch.id, i));
    lineSwitch.appendChild(b);
  });
}

/* ---------------- 播放 ---------------- */
function destroyHls() {
  if (hls) { try { hls.destroy(); } catch (_) {} hls = null; }
}

function playChannel(channelId, lineIndex) {
  const ch = DATA.channels.find((c) => c.id === channelId);
  if (!ch || !ch.sources[lineIndex]) return;
  current = { channelId, lineIndex };
  const src = ch.sources[lineIndex];

  destroyHls();
  video.pause();
  video.removeAttribute('src');
  video.load();
  corsHint.textContent = '';

  const url = src.url;
  // 有代理则走代理（绕开跨域限制），否则直连
  const playUrl = proxyUrl(url);
  overlay.textContent = `正在连接 ${ch.id} · 线路${lineIndex + 1}…`;
  overlay.classList.remove('hide');
  nowPlaying.textContent = `▶ ${ch.name} · 线路${lineIndex + 1}（${resLabel(src)}）`;

  if (window.Hls && window.Hls.isSupported()) {
    hls = new window.Hls({ lowLatencyMode: true, maxBufferLength: 20 });
    hls.loadSource(playUrl);
    hls.attachMedia(video);
    hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
      overlay.classList.add('hide');
      video.play().catch(() => {});
    });
    hls.on(window.Hls.Events.ERROR, (_, data) => {
      if (data.fatal) {
        // 静态版无服务端代理，失败通常是源限制跨域或已失效，直接切下一条
        overlay.textContent = `线路${lineIndex + 1} 播放失败，正在尝试下一条…`;
        overlay.classList.remove('hide');
        tryNextLine(channelId, lineIndex);
      }
    });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = playUrl;
    video.addEventListener('loadedmetadata', () => { overlay.classList.add('hide'); video.play().catch(() => {}); }, { once: true });
    video.addEventListener('error', () => tryNextLine(channelId, lineIndex), { once: true });
  } else {
    overlay.textContent = '当前浏览器不支持 HLS 播放';
  }

  renderGrid();
  renderLines();
  document.querySelector('.hero-player').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function tryNextLine(channelId, fromIndex) {
  const ch = DATA.channels.find((c) => c.id === channelId);
  if (!ch) return;
  const next = fromIndex + 1;
  if (next < ch.sources.length) {
    setTimeout(() => playChannel(channelId, next), 600);
  } else {
    overlay.textContent = `${ch.id} 所有线路均播放失败`;
    overlay.classList.remove('hide');
    corsHint.textContent = RELAY_AVAILABLE
      ? '提示：所有线路当前均不可用，可稍后重试，或下载 m3u 用 PotPlayer / VLC 播放。'
      : '提示：当前部署未启用跨域代理，网页只能播放少数源。建议下载 m3u 用 PotPlayer / VLC / 电视盒子播放。';
  }
}

/* ---------------- 数据加载 ---------------- */
async function load() {
  await detectRelay();
  try {
    const res = await fetch('./sources.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    DATA = await res.json();
    if (!DATA.channels || !DATA.channels.length) throw new Error('数据为空');
    renderStatus();
    renderGrid();
    renderLines();
    $('#foot-time').textContent = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  } catch (e) {
    grid.innerHTML = `<div class="card" style="grid-column:1/-1">
      <div class="card-name">数据尚未生成</div>
      <div class="card-sub">请等待 GitHub Actions 首次运行完成（可在仓库 Actions 页手动触发），或用本地脚本生成 docs/sources.json。</div>
    </div>`;
    toast('加载 sources.json 失败：' + e.message);
  }
}

/* ---------------- 事件 ---------------- */
$('#btn-copy').addEventListener('click', async () => {
  try {
    const r = await fetch('./sources.m3u', { cache: 'no-store' });
    copy(await r.text());
  } catch (e) { toast('复制失败'); }
});

load();
