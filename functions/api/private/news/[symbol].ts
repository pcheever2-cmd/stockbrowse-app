/**
 * GET /api/private/news/{symbol} — recent headlines for the AI's adverse-event
 * review (the owner's philosophy: check the news before acting on an idea).
 *
 * Proxies FMP stock news (Pages secret FMP_API_KEY), mapped to explicit fields
 * so the API key can never echo into a response. Cached in KV 30 minutes;
 * `?fresh=1` bypasses. Raw items only — no sentiment or adverse flag; event
 * judgment belongs to the consuming AI. On provider failure: 502 (fall back
 * to web search).
 */
import { requireAssistantKey, privateJson, type AssistantEnv } from '../../../lib/assistant-auth';
import { errorResponse } from '../../../_middleware';

interface Env extends AssistantEnv {
  FMP_API_KEY: string;
}

interface Article { date: string | null; title: string | null; site: string | null; url: string | null; snippet: string | null }

const CACHE_TTL_SECONDS = 1800;

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const denied = requireAssistantKey(env, request);
  if (denied) return denied;

  const symbol = String(params.symbol || '').toUpperCase();
  if (!symbol || !/^[A-Z0-9.\-]{1,12}$/.test(symbol)) {
    return errorResponse('invalid symbol', 400);
  }
  if (!env.FMP_API_KEY) {
    return errorResponse('news provider not configured (FMP_API_KEY unset)', 503);
  }

  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit')) || 25, 50));
  const fresh = url.searchParams.get('fresh') === '1';
  const cacheKey = `newscache:${symbol}`;

  if (!fresh) {
    const cached = await env.STOCKS_PREMIUM_KV.get<Article[]>(cacheKey, 'json');
    if (cached) {
      return privateJson({ symbol, cached: true, articles: cached.slice(0, limit) });
    }
  }

  let raw: unknown;
  try {
    const resp = await fetch(
      `https://financialmodelingprep.com/stable/news/stock?symbols=${encodeURIComponent(symbol)}&limit=50&apikey=${env.FMP_API_KEY}`,
      { headers: { Accept: 'application/json' } }
    );
    if (!resp.ok) return errorResponse('news provider unavailable', 502);
    raw = await resp.json();
  } catch {
    return errorResponse('news provider unavailable', 502);
  }
  if (!Array.isArray(raw)) return errorResponse('news provider unavailable', 502);

  // Map defensively field-by-field — nothing from our env can leak through.
  const articles: Article[] = raw.map((a: Record<string, unknown>) => ({
    date: typeof a.publishedDate === 'string' ? a.publishedDate : null,
    title: typeof a.title === 'string' ? a.title : null,
    site: typeof a.site === 'string' ? a.site : (typeof a.publisher === 'string' ? a.publisher : null),
    url: typeof a.url === 'string' ? a.url : null,
    snippet: typeof a.text === 'string' ? a.text.slice(0, 300) : null,
  })).filter(a => a.title);

  try {
    await env.STOCKS_PREMIUM_KV.put(cacheKey, JSON.stringify(articles), {
      expirationTtl: CACHE_TTL_SECONDS,
    });
  } catch {
    // Cache is best-effort — never fail a response we already have in hand.
  }

  return privateJson({
    symbol,
    cached: false,
    fetchedAt: new Date().toISOString(),
    articles: articles.slice(0, limit),
  });
};
