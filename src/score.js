'use strict';
/**
 * score.js —— 直播源质量打分与排序
 *
 * 设计目标：让「实测带宽高 + 分辨率高 + 起播快」的源排到前面。
 *
 * 为什么带宽是主项而不是分辨率：
 *   实测数据显示，同一批源里 1080p 的境外机房源带宽只有 2 Mbps（播放必然卡），
 *   而 1080p 的境内广电 CDN 有 60+ Mbps。两者分辨率相同、体验天差地别。
 *   所以分辨率是「达标项」（够 1080p 就给满分，再多没意义），带宽是「区分项」。
 *
 * 分档而非线性：避免出现「码率 20000kbps 但只有 480p」的源压过
 * 「码率 8000kbps 的 1080p」——后者观看体验明显更好。
 *
 * 低带宽「地板惩罚」：实测带宽低于 poor 档（默认 1200kbps）的源，
 * 无论分辨率多高都基本看不了，此时分辨率加成反而是误导，
 * 所以对这些源额外扣分，使其稳定沉到列表末尾。
 */

const CONFIG = require('./config');

const S = () => CONFIG.score || {};

/** 带宽分（0 ~ 100） */
function kbpsScore(kbps) {
  const c = S().kbps || {};
  const k = kbps || 0;
  if (k >= (c.excellent ?? 8000)) return 100;
  if (k >= (c.good ?? 4000)) return 80;
  if (k >= (c.fair ?? 2500)) return 55;
  if (k >= (c.poor ?? 1200)) return 25;
  return c.bad ?? 0;
}

/** 分辨率分（0 ~ 60）：达标即满分，不无限加成 */
function heightScore(h) {
  const c = S().height || {};
  const v = h || 0;
  if (v >= 1080) return c.h1080 ?? 60;
  if (v >= 720) return c.h720 ?? 38;
  if (v >= 576) return c.h576 ?? 20;
  return c.other ?? 8;
}

/** 起播延迟惩罚（0 ~ 15，越大扣越多） */
function latencyPenalty(ms) {
  const ref = S().latencyPenaltyRefMs ?? 5000;
  const max = S().latencyPenaltyMax ?? 15;
  const v = Math.max(0, ms || 0);
  return Math.min(max, (v / ref) * max);
}

/**
 * 综合评分
 * @returns {{total:number, kbps:number, height:number, latency:number, grade:string}}
 */
function scoreSource(s) {
  const sKbps = kbpsScore(s.kbps);
  const sH = heightScore(s.height);
  const sL = latencyPenalty(s.latencyMs);

  let total = sKbps + sH - sL;

  // 测不出带宽的源：能播但未知快慢，扣分让其靠后，但不剔除
  if (!s.kbps) total -= S().noBandwidthPenalty ?? 20;

  // 地板惩罚：带宽低于 poor 档的源基本看不了，分辨率加成反而是误导
  const poorFloor = (S().kbps || {}).poor ?? 1200;
  if (s.kbps > 0 && s.kbps < poorFloor) {
    total -= S().belowFloorPenalty ?? 34;
  }

  // IPv6 运营商 IPTV 源：本机（多为 IPv4-only 出口）测不了速，但这类源是
  // 移动/联通的本地 IPTV，对「同运营商同网段的电视」是内网级速度，往往最好。
  //
  // 给一个「有竞争力的保底分」：让它胜过「实测极差」的源（那些基本看不了），
  // 但**绝不越过任何实测达标的源**——未经验证的东西不该排第一。
  //   实测 >=2.5Mbps → 至少 55 分，所以保底取其下：40 分
  if (s.ipv6Unverified) {
    const floorScore = S().ipv6UnverifiedFloor ?? 40;
    total = Math.max(total, floorScore);
  }

  // 无音轨的源对电视观看是硬伤，扣分
  if (s.hasAudio === false) total -= S().noAudioPenalty ?? 18;

  total = Math.max(0, Math.round(total));

  let grade;
  if (total >= 130) grade = '优';
  else if (total >= 95) grade = '良';
  else if (total >= 60) grade = '中';
  else grade = '差';

  return {
    total,
    kbps: sKbps,
    height: sH,
    latency: Math.round(sL),
    grade,
  };
}

/** 按质量降序排序（不改原数组） */
function sortByQuality(list) {
  return [...list].sort((a, b) => {
    const sa = scoreSource(a).total;
    const sb = scoreSource(b).total;
    if (sb !== sa) return sb - sa;
    // 同分时带宽高者优先，再同则延迟低者优先
    if ((b.kbps || 0) !== (a.kbps || 0)) return (b.kbps || 0) - (a.kbps || 0);
    return (a.latencyMs || 0) - (b.latencyMs || 0);
  });
}

/** 生成给用户看的线路标签后缀，如「1080P · 62Mbps」 */
function qualityLabel(s) {
  const parts = [];
  // IPv6 运营商源的 height 常为 0（本机探不到），不显示「0P」这种误导性文字
  if (s.ipv6Unverified) {
    parts.push('IPv6');
    parts.push('运营商内网');
  } else {
    if (s.height) parts.push(`${s.height}P`);
    if (s.kbps) parts.push(s.kbps >= 1000 ? `${(s.kbps / 1000).toFixed(1)}Mbps` : `${s.kbps}kbps`);
    else parts.push('速度未知');
  }
  return parts.join(' · ');
}

module.exports = { scoreSource, sortByQuality, qualityLabel, kbpsScore, heightScore, latencyPenalty };
