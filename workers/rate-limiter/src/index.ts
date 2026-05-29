/**
 * Rate-limiter Worker. Bound to the Pages app via a service binding.
 *
 * Request: GET https://rl/?key=<identifier>  (the app passes the caller's IP as key)
 * Response: 200 {success:true} if within the limit, 429 {success:false} if exceeded.
 * Missing key → allowed (fail open). The limit/period are set in wrangler.toml.
 */
interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

interface Env {
  LIMITER: RateLimit;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const key = new URL(request.url).searchParams.get('key') || '';
    if (!key) return Response.json({ success: true });

    const { success } = await env.LIMITER.limit({ key });
    return Response.json({ success }, { status: success ? 200 : 429 });
  },
};
