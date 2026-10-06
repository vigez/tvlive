/**
 * Cloudflare Pages Function —— /relay?url=<原始源地址>
 *
 * 作用：解决浏览器的跨域（CORS）限制。
 * 绝大多数公开直播源不返回 Access-Control-Allow-Origin 头，
 * 浏览器直连会被拦截（实测只有 4/18 频道能直连）。
 * 通过本代理由 Cloudflare 服务端去拉流再转发给浏览器，即可绕过该限制。
 *
 * 部署：Cloudflare Pages 会自动识别站点根目录下的 functions/ 目录，
 *       本文件路径为 docs/functions/relay.js → 对应路由 /relay
 *
 * 安全：限制只允许代理 .m3u8 / .ts 等直播相关资源，避免被当作开放代理滥用。
 */
export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const target = url.searchParams.get('url');

  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  };

  // 预检
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  if (!target || !/^https?:\/\//i.test(target)) {
    return new Response('缺少或非法的 url 参数', { status: 400, headers: cors });
  }

  // 只放行常见直播流资源，防止被滥用为通用代理
  const isAllowed =
    /\.m3u8(\?|$)/i.test(target) ||
    /\.ts(\?|$)/i.test(target) ||
    /\.m4s(\?|$)/i.test(target) ||
    /\.mp4(\?|$)/i.test(target) ||
    /\/(live|hls|gslb|play|tsfile)\//i.test(target);
  if (!isAllowed) {
    return new Response('仅允许代理直播流资源（m3u8/ts/m4s/mp4）', { status: 403, headers: cors });
  }

  try {
    const origin = new URL(target).origin;
    const upstream = await fetch(target, {
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        Referer: origin + '/',
        Accept: '*/*',
      },
      redirect: 'follow',
    });

    if (!upstream.ok) {
      return new Response('上游返回 ' + upstream.status, { status: upstream.status, headers: cors });
    }

    const ct = upstream.headers.get('content-type') || '';
    const isPlaylist = /mpegurl|m3u/i.test(ct) || /\.m3u8(\?|$)/i.test(target);

    if (isPlaylist) {
      // 关键：部分源会 302 跳转到带时效签名的地址（如 ?tm=...&key=...）。
      // 分片路径必须相对【跳转后的最终地址】解析，否则拼出来的分片地址是错的。
      const base = new URL(upstream.url || target);
      const text = await upstream.text();
      const proxied = text
        .split(/\r?\n/)
        .map((line) => {
          const t = line.trim();
          if (!t) return line;
          if (t.startsWith('#')) {
            // 处理 #EXT-X-KEY / #EXT-X-MAP 等带 URI="..." 的标签
            return line.replace(/URI="([^"]+)"/g, (m, u) => {
              try {
                const abs = new URL(u, base).toString();
                return `URI="/relay?url=${encodeURIComponent(abs)}"`;
              } catch {
                return m;
              }
            });
          }
          try {
            const abs = new URL(t, base).toString();
            return `/relay?url=${encodeURIComponent(abs)}`;
          } catch {
            return line;
          }
        })
        .join('\n');

      // 同时把跳转后的最终地址通过响应头告知前端，便于排查
      return new Response(proxied, {
        status: 200,
        headers: {
          ...cors,
          'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Relay-Final-Url': base.toString(),
        },
      });
    }

    // 分片等二进制资源：流式转发，不落盘
    return new Response(upstream.body, {
      status: 200,
      headers: {
        ...cors,
        'Content-Type': ct || 'video/mp2t',
        'Cache-Control': 'public, max-age=10',
      },
    });
  } catch (e) {
    return new Response('代理失败: ' + (e && e.message ? e.message : 'unknown'), {
      status: 502,
      headers: cors,
    });
  }
}
