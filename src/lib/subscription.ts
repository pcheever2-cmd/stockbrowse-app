/**
 * Subscription management for premium features
 * For beta: Uses localStorage to track subscription tier
 * For production: Will integrate with payment provider (Stripe) and auth system
 */

export type SubscriptionTier = 'free' | 'basic' | 'plus' | 'pro';

/**
 * Get the current user's subscription tier
 * @returns The subscription tier ('free' by default)
 */
export function getSubscriptionTier(): SubscriptionTier {
  if (typeof window === 'undefined') {
    return 'free'; // Server-side rendering default
  }

  const tier = localStorage.getItem('subscriptionTier');
  return (tier as SubscriptionTier) || 'free';
}

/**
 * Set the user's subscription tier (for testing)
 * @param tier The subscription tier to set
 */
export function setSubscriptionTier(tier: SubscriptionTier): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem('subscriptionTier', tier);
  }
}

/**
 * Check if the user has access to a specific feature
 * @param feature The feature to check access for
 * @returns True if the user's tier includes the feature
 */
export function hasFeature(feature: string): boolean {
  const tier = getSubscriptionTier();

  const features: Record<SubscriptionTier, string[]> = {
    free: [],
    basic: ['score_breakdown', 'unlimited_lookups', 'csv_export'],
    plus: ['score_breakdown', 'unlimited_lookups', 'csv_export', 'watchlists', 'alerts', 'similar_stocks'],
    pro: ['score_breakdown', 'unlimited_lookups', 'csv_export', 'watchlists', 'alerts', 'similar_stocks', 'api_access', 'bulk_export', 'historical_data'],
  };

  return features[tier]?.includes(feature) || false;
}

/**
 * Get the minimum tier required for a feature
 * @param feature The feature name
 * @returns The minimum tier name or null if feature doesn't exist
 */
export function getRequiredTier(feature: string): SubscriptionTier | null {
  if (hasFeature(feature)) {
    return getSubscriptionTier(); // User already has access
  }

  // Find minimum tier that has this feature
  const tiers: SubscriptionTier[] = ['basic', 'plus', 'pro'];
  for (const tier of tiers) {
    const features: Record<SubscriptionTier, string[]> = {
      free: [],
      basic: ['score_breakdown', 'unlimited_lookups', 'csv_export'],
      plus: ['score_breakdown', 'unlimited_lookups', 'csv_export', 'watchlists', 'alerts', 'similar_stocks'],
      pro: ['score_breakdown', 'unlimited_lookups', 'csv_export', 'watchlists', 'alerts', 'similar_stocks', 'api_access', 'bulk_export', 'historical_data'],
    };

    if (features[tier].includes(feature)) {
      return tier;
    }
  }

  return null;
}
