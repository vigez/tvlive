'use strict';
/**
 * 全局配置：频道表、源池、校验参数、定时策略
 */

const path = require('path');

// 只收录中央台：CCTV-1 ~ CCTV-17 及 CCTV-5+
// logo 使用「CCTV 台标色块」风格的纯文本标记，避免不同系统 emoji 字体渲染差异
const CHANNELS = [
  { id: 'CCTV-1',  name: 'CCTV-1 综合',       logo: 'C1'  },
  { id: 'CCTV-2',  name: 'CCTV-2 财经',       logo: 'C2'  },
  { id: 'CCTV-3',  name: 'CCTV-3 综艺',       logo: 'C3'  },
  { id: 'CCTV-4',  name: 'CCTV-4 中文国际',   logo: 'C4'  },
  { id: 'CCTV-5',  name: 'CCTV-5 体育',       logo: 'C5'  },
  { id: 'CCTV-5+', name: 'CCTV-5+ 赛事',      logo: 'C5+' },
  { id: 'CCTV-6',  name: 'CCTV-6 电影',       logo: 'C6'  },
  { id: 'CCTV-7',  name: 'CCTV-7 国防军事',   logo: 'C7'  },
  { id: 'CCTV-8',  name: 'CCTV-8 电视剧',     logo: 'C8'  },
  { id: 'CCTV-9',  name: 'CCTV-9 纪录',       logo: 'C9'  },
  { id: 'CCTV-10', name: 'CCTV-10 科教',      logo: 'C10' },
  { id: 'CCTV-11', name: 'CCTV-11 戏曲',      logo: 'C11' },
  { id: 'CCTV-12', name: 'CCTV-12 社会与法',  logo: 'C12' },
  { id: 'CCTV-13', name: 'CCTV-13 新闻',      logo: 'C13' },
  { id: 'CCTV-14', name: 'CCTV-14 少儿',      logo: 'C14' },
  { id: 'CCTV-15', name: 'CCTV-15 音乐',      logo: 'C15' },
  { id: 'CCTV-16', name: 'CCTV-16 奥林匹克',  logo: 'C16' },
  { id: 'CCTV-17', name: 'CCTV-17 农业农村',  logo: 'C17' },
];

// 源池：多池聚合是覆盖率的保证，任一池失败不影响整体
// 每个池可配置 url 与 mirrors（备用镜像，主地址失败时依次尝试）
const SOURCE_POOLS = [
  {
    name: 'Guovin/TV',
    url: 'https://raw.githubusercontent.com/Guovin/TV/gd/output/result.m3u',
    mirrors: [
      'https://cdn.jsdelivr.net/gh/Guovin/TV@gd/output/result.m3u',
      'https://gh-proxy.com/https://raw.githubusercontent.com/Guovin/TV/gd/output/result.m3u',
    ],
    primary: true,
  },
  {
    name: 'iptv-org',
    url: 'https://iptv-org.github.io/iptv/categories/general.m3u',
    mirrors: ['https://raw.githubusercontent.com/iptv-org/iptv/master/categories/general.m3u'],
  },
  {
    name: 'vbskycn/iptv',
    url: 'https://raw.githubusercontent.com/vbskycn/iptv/master/tv/iptv4.m3u',
    mirrors: ['https://cdn.jsdelivr.net/gh/vbskycn/iptv@master/tv/iptv4.m3u'],
  },
  {
    name: 'YanG-1989/m3u',
    url: 'https://raw.githubusercontent.com/YanG-1989/m3u/main/Gather.m3u',
    mirrors: ['https://cdn.jsdelivr.net/gh/YanG-1989/m3u@main/Gather.m3u'],
  },
  {
    name: 'wwb521/live',
    url: 'https://raw.githubusercontent.com/wwb521/live/main/tv.m3u',
    mirrors: ['https://cdn.jsdelivr.net/gh/wwb521/live@main/tv.m3u'],
  },
  // 以下池子实测能补到「境内直连 + 高带宽」的源，权重上是重点
  {
    name: 'iptv-org/CN',
    url: 'https://iptv-org.github.io/iptv/countries/cn.m3u',
    mirrors: ['https://raw.githubusercontent.com/iptv-org/iptv/master/countries/cn.m3u'],
  },
  {
    name: 'Guovin/TV-ipv4',
    url: 'https://raw.githubusercontent.com/Guovin/TV/gd/output/result_ipv4.m3u',
    mirrors: ['https://cdn.jsdelivr.net/gh/Guovin/TV@gd/output/result_ipv4.m3u'],
  },
  {
    name: 'Guovin/TV-ipv6',
    url: 'https://raw.githubusercontent.com/Guovin/TV/gd/output/result_ipv6.m3u',
    mirrors: ['https://cdn.jsdelivr.net/gh/Guovin/TV@gd/output/result_ipv6.m3u'],
  },
  {
    name: 'fanmingming/live',
    url: 'https://raw.githubusercontent.com/fanmingming/live/main/tv/m3u/ipv6.m3u',
    mirrors: ['https://cdn.jsdelivr.net/gh/fanmingming/live@main/tv/m3u/ipv6.m3u'],
  },
  {
    name: 'kimwang1978',
    url: 'https://raw.githubusercontent.com/kimwang1978/collect-tv-txt/main/iptv4.m3u',
    mirrors: ['https://cdn.jsdelivr.net/gh/kimwang1978/collect-tv-txt@main/iptv4.m3u'],
  },
  {
    name: 'best-fan/iptv',
    url: 'https://raw.githubusercontent.com/best-fan/iptv/main/CCTV.m3u',
    mirrors: ['https://cdn.jsdelivr.net/gh/best-fan/iptv@main/CCTV.m3u'],
  },
];

const CONFIG = {
  CHANNELS,
  SOURCE_POOLS,

  userAgent: 'CCTV-Live-Updater/2.0',

  // 抓取
  fetchTimeoutMs: 45000,
  fetchConcurrency: 5,

  // 校验（ffprobe）
  probeTimeoutMs: 10000,     // 单条探测硬超时
  probeRwTimeoutMs: 6000000, // ffprobe -rw_timeout
  probeConcurrency: 30,
  probeRetries: 1,           // 失败后重试次数

  // 带宽实测（新增）：连续拉若干分片，量真实下载速度
  bandwidthSampleCount: 5,   // 最多连续拉几个分片
  bandwidthBudgetMs: 6000,   // 单条源最多花多少毫秒做测速
  bandwidthOn: true,         // 关掉可退回「只校验不测速」

  // 发布策略
  maxSourcesPerChannel: 5,   // 每频道最多保留多少条线路
  maxIpv6PerChannel: 3,      // 每频道最多收录多少条 IPv6 源（本机测不了速，限量）

  // 排序权重：真实带宽为主，分辨率次之
  // 分档给分，避免为了快一点就牺牲清晰度，也避免高分低俗的源占首位
  score: {
    kbps: {
      excellent: 8000,       // >= 8 Mbps  记 100 分  ← 境内广电 CDN 常在此档
      good: 4000,            // >= 4 Mbps  记 80 分
      fair: 2500,            // >= 2.5 Mbps 记 55 分 ← 1080p 直播的下限附近
      poor: 1200,            // >= 1.2 Mbps 记 25 分
      bad: 0,                // 其余        记 0 分
    },
    // 分辨率权重（0~60）
    height: { h1080: 60, h720: 38, h576: 20, other: 8 },
    // 起播延迟惩罚上限（毫秒），最多扣 15 分
    latencyPenaltyMax: 15,
    latencyPenaltyRefMs: 5000,
    // 测不出带宽的源扣分（但不剔除）
    noBandwidthPenalty: 20,
    // 带宽低于 poor 档时的额外地板惩罚（这类源基本看不了）
    belowFloorPenalty: 34,
    // IPv6 运营商 IPTV 源的加分（本机测不了速，但对同网段电视极快）
    ipv6UnverifiedFloor: 40,
    // 无音轨扣分
    noAudioPenalty: 18,
  },

  // 定时：每天北京时间 05:00
  cronExpression: '0 5 * * *',
  cronTimeZone: 'Asia/Shanghai',

  // 服务
  port: process.env.PORT || 3000,

  // 路径
  paths: {
    dataDir: path.join(__dirname, '..', 'data'),
    sourcesJson: path.join(__dirname, '..', 'data', 'sources.json'),
    sourcesM3u: path.join(__dirname, '..', 'data', 'sources.m3u'),
    historyLog: path.join(__dirname, '..', 'data', 'history.log'),
    publicDir: path.join(__dirname, '..', 'public'),
  },
};

module.exports = CONFIG;
