/**
 * Cloudflare Worker: Mihomo/FlClash 真实美国出口检测
 *
 * /us:
 *   - 请求来源国家为 US -> HTTP 204
 *   - 其他国家/未知       -> HTTP 451
 *
 * Mihomo 配置示例：
 *   url: https://<your-worker>.workers.dev/us
 *   expected-status: "204"
 *
 * 不记录或返回访问者 IP；国家判断来自 Cloudflare request.cf.country。
 */
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const country = (request.cf && request.cf.country) || "XX";

    if (url.pathname === "/us") {
      if (country === "US") {
        return new Response(null, {
          status: 204,
          headers: {
            "Cache-Control": "no-store",
            "X-Country": country,
          },
        });
      }

      return new Response("not-us", {
        status: 451,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Country": country,
        },
      });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        country,
        usage: "/us returns 204 only for US source IPs",
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        },
      }
    );
  },
};
