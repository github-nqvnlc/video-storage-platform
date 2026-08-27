/**
 * Cloudflare Worker: Smart HLS Video Caching & Edge Gateway
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const originHost = env.ORIGIN_HOST || 'http://localhost';
    const originUrl = new URL(url.pathname + url.search, originHost);

    // 1. Tối ưu Cache phân đoạn video HLS (.ts) tại Edge toàn cầu của Cloudflare
    if (url.pathname.endsWith('.ts')) {
      const cache = caches.default;
      let response = await cache.match(request);

      if (!response) {
        // Cache miss -> Tải từ máy chủ gốc MinIO
        const fetchRequest = new Request(originUrl.toString(), {
          method: 'GET',
          headers: request.headers,
        });

        response = await fetch(fetchRequest);

        // Lưu vào Cloudflare Edge Cache 30 ngày (2592000s)
        if (response.status === 200) {
          const headers = new Headers(response.headers);
          headers.set('Cache-Control', 'public, max-age=2592000, immutable');
          headers.set('Access-Control-Allow-Origin', '*');
          headers.set('X-Edge-Cache', 'HIT-CLOUDFLARE');

          response = new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers,
          });

          ctx.waitUntil(cache.put(request, response.clone()));
        }
      }
      return response;
    }

    // 2. Không cache playlist master.m3u8 (để luôn cập nhật trạng thái mới nhất)
    if (url.pathname.endsWith('.m3u8')) {
      const fetchRequest = new Request(originUrl.toString(), {
        method: request.method,
        headers: request.headers,
      });
      const res = await fetch(fetchRequest);
      const headers = new Headers(res.headers);
      headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      headers.set('Access-Control-Allow-Origin', '*');
      return new Response(res.body, {
        status: res.status,
        headers,
      });
    }

    // 3. Chuyển tiếp các request API (/api/*) và Frontend (/) về máy chủ gốc
    const proxyRequest = new Request(originUrl.toString(), {
      method: request.method,
      headers: request.headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      redirect: 'follow',
    });

    return fetch(proxyRequest);
  },
};
