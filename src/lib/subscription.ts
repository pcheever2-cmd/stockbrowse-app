/**
 * Subscription management — server-backed via /api/auth/me.
 *
 * The user's tier is fetched from Supabase (via a Pages Function) on page load
 * and cached on `window.__compassUser`. No tier values are ever stored in
 * localStorage — that would be bypassable. The only source of truth for
 * subscription_tier is the `profiles` table in Supabase.
 *
 * On first /api/auth/me call, any stale `localStorage.subscriptionTier` from
 * the old beta cheat code is actively deleted.
 */

export type SubscriptionTier = 'free' | 'newsletter' | 'plus' | 'pro';

export interface CompassUser {
  id: string;
  email: string;
  tier: SubscriptionTier;
}

// Feature matrix — what each tier unlocks.
// Keep in sync with requireAuth(ctx, minTier) in functions/_middleware.ts.
const TIER_FEATURES: Record<SubscriptionTier, string[]> = {
  free: ['price_chart_1y'],
  newsletter: ['price_chart_1y', 'newsletter_monthly'],
  plus: [
    'price_chart_1y', 'price_chart_5y',
    'score_breakdown', 'moonshot_score', 'long_term_score',
    'analyst_targets', 'analyst_accuracy', 'financial_health',
    'csv_export', 'watchlist_single',
  ],
  pro: [
    'price_chart_1y', 'price_chart_5y',
    'score_breakdown', 'moonshot_score', 'long_term_score',
    'analyst_targets', 'analyst_accuracy', 'financial_health',
    'csv_export', 'watchlist_single',
    'valuation_score', 'watchlist_multi', 'sms_alerts',
  ],
};

// Tier hierarchy for comparison
const TIER_ORDER: SubscriptionTier[] = ['free', 'newsletter', 'plus', 'pro'];

/**
 * Get the cached user object, or null if not logged in.
 * Populated by the session loader script in Layout.astro.
 */
export function getUser(): CompassUser | null {
  if (typeof window === 'undefined') return null;
  return (window as any).__compassUser ?? null;
}

/**
 * Get the current user's subscription tier.
 * Returns 'free' if not logged in.
 */
export function getSubscriptionTier(): SubscriptionTier {
  return getUser()?.tier ?? 'free';
}

/**
 * Check if the user has access to a specific feature.
 */
export function hasFeature(feature: string): boolean {
  const tier = getSubscriptionTier();
  return TIER_FEATURES[tier]?.includes(feature) ?? false;
}

/**
 * Get the minimum tier required for a feature.
 * Returns null if the feature doesn't exist in any tier.
 */
export function getRequiredTier(feature: string): SubscriptionTier | null {
  for (const tier of TIER_ORDER) {
    if (TIER_FEATURES[tier].includes(feature)) {
      return tier;
    }
  }
  return null;
}

/**
 * Check if tierA >= tierB in the hierarchy.
 */
export function tierAtLeast(tierA: SubscriptionTier, tierB: SubscriptionTier): boolean {
  return TIER_ORDER.indexOf(tierA) >= TIER_ORDER.indexOf(tierB);
}

/**
 * Fetch the user's profile from /api/auth/me and cache on window.__compassUser.
 * Called once by the session loader in Layout.astro on page load.
 * Also clears any stale localStorage.subscriptionTier from the old beta cheat.
 */
export async function loadSession(): Promise<CompassUser | null> {
  if (typeof window === 'undefined') return null;

  // Clear stale beta cheat — the DB is the only source of truth now
  localStorage.removeItem('subscriptionTier');

  try {
    // Import dynamically to avoid SSR issues
    const { getAccessToken } = await import('./supabase');
    const token = await getAccessToken();
    if (!token) {
      (window as any).__compassUser = null;
      return null;
    }

    const res = await fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      (window as any).__compassUser = null;
      return null;
    }

    const user: CompassUser = await res.json();
    (window as any).__compassUser = user;
    return user;
  } catch {
    (window as any).__compassUser = null;
    return null;
  }
}
