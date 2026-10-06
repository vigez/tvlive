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
];

const CONFIG = {
  CHANNELS,
  SOURCE_POOLS,

  // 抓取
  fetchTimeoutMs: 45000,
  fetchConcurrency: 5,

  // 校验（ffprobe）
  probeTimeoutMs: 10000,     // 单条探测硬超时
  probeRwTimeoutMs: 6000000, // ffprobe -rw_timeout
  probeConcurrency: 30,
  probeRetries: 1,           // 失败后重试次数

  // 发布策略
  maxSourcesPerChannel: 5,   // 每频道最多保留多少条线路

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
