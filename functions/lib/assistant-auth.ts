/**
 * Auth for the private assistant API (/api/private/*).
 *
 * A single static key (Pages secret ASSISTANT_API_KEY) sent as
 * `Authorization: Bearer <key>`, compared in constant time — same
 * refuse-if-unset pattern as the admin REINDEX_SECRET endpoints.
 * Consumers are AI assistants the owner shares the key with; responses
 * are never cacheable and never get CORS headers (see _middleware).
 */
import { safeEqual, errorResponse } from '../_middleware';

export interface AssistantEnv {
  ASSISTANT_API_KEY: string;
  STOCKS_PREMIUM_KV: KVNamespace;
}

/** Returns null when authorized, else a 401 Response to return as-is. */
export function requireAssistantKey(env: AssistantEnv, request: Request): Response | null {
  const authHeader = request.headers.get('Authorization') || '';
  if (!env.ASSISTANT_API_KEY || !safeEqual(authHeader, `Bearer ${env.ASSISTANT_API_KEY}`)) {
    return errorResponse('unauthorized', 401);
  }
  return null;
}

export function privateJson(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, no-store',
    },
  });
}
