# Product Tiers & Feature Matrix

## Tier Hierarchy
`free` → `newsletter` → `plus` → `pro`

## Feature Matrix

| Feature | Free | Newsletter | Plus | Pro |
|---------|------|------------|------|-----|
| **Stock Pages** |
| Compass Score + Grade | Yes | Yes | Yes | Yes |
| Company Profile / About | Yes | Yes | Yes | Yes |
| Quality Assessment Summary | Yes | Yes | Yes | Yes |
| Score Breakdown (Strong/Average/Weak labels) | Yes | Yes | Yes | Yes |
| Score Breakdown (numeric factor values) | - | - | Yes | Yes |
| Moonshot Score (circle shown, score locked) | Locked | Locked | Yes | Yes |
| **Valuation** |
| Valuation Metrics (EV/EBITDA, Forward P/E, PEG) | Locked | Locked | Yes | Yes |
| Technical Valuation (Rating, SMA, 52W Range) | Hidden | Hidden | Yes | Yes |
| Valuation Score | - | - | - | Yes |
| **Analyst Data** |
| Wall Street Consensus (Buy/Hold/Sell from public field) | Yes | Yes | Yes | Yes |
| Wall Street Consensus (detailed Strong Buy breakdown) | - | - | Yes | Yes |
| Number of Analysts | Yes | Yes | Yes | Yes |
| Price Target | Locked | Locked | Yes | Yes |
| Upside % | Locked | Locked | Yes | Yes |
| Analyst Track Record (covering firms + sector & overall hit rates) | - | - | Yes | Yes |
| Sector Analyst Accuracy | - | - | Yes | Yes |
| **Technical** |
| RSI (14) | Locked | Locked | Yes | Yes |
| vs 50-Day SMA | Locked | Locked | Yes | Yes |
| vs 200-Day SMA | Locked | Locked | Yes | Yes |
| **Growth & Health** |
| Projected EPS Growth | Locked | Locked | Yes | Yes |
| Projected Revenue Growth | Locked | Locked | Yes | Yes |
| Piotroski F-Score | Locked | Locked | Yes | Yes |
| Altman Z-Score | Locked | Locked | Yes | Yes |
| **Browse Page** |
| All filters (grade, industry, price, cap, moonshot) | Yes | Yes | Yes | Yes |
| Valuation filter (Undervalued/Fair Value/Overvalued) | - | - | - | Yes |
| **Other** |
| Price Chart (1 year) | Yes | Yes | Yes | Yes |
| Price Chart (5 year) | - | - | Yes | Yes |
| Monthly Newsletter | - | Yes | Yes | Yes |
| CSV Export | - | - | Yes | Yes |
| Single Watchlist | - | - | Yes | Yes |
| Multiple Watchlists | - | - | - | Yes |
| SMS Alerts | - | - | - | Yes |

## Code References

**Client-side feature checks:** `src/lib/subscription.ts` — `TIER_FEATURES` object
```
free:       ['price_chart_1y']
newsletter: ['price_chart_1y', 'newsletter_monthly']
plus:       ['score_breakdown', 'moonshot_score', 'long_term_score',
             'analyst_targets', 'analyst_accuracy', 'financial_health',
             'csv_export', 'watchlist_single', ...]
pro:        [all of plus + 'valuation_score', 'watchlist_multi', 'sms_alerts']
```

**Server-side tier enforcement:** `functions/_middleware.ts` — `requireAuth(env, request, minTier)`
- `/api/stocks/premium` requires minimum `'plus'`
- `/api/auth/me` requires any authenticated user

**Data split:**
- Public (SSG): `src/data/stocks-public.json` — score, grade, price, industry, consensus letter, moonshotGrade
- Premium (KV): `src/data/stocks-premium.json` → synced to Cloudflare KV → fetched via `/api/stocks/premium`

## Supabase Setup Required

For auth to work without `?dev=1`:

1. **profiles table** must have a row for each user with `subscription_tier` column
2. User `pcheever2@gmail.com` needs `subscription_tier = 'pro'`
3. **Auth > URL Configuration:**
   - Site URL: `https://stockbrowse-app-pages.pages.dev` (or custom domain)
   - Redirect URLs: `https://stockbrowse-app-pages.pages.dev/auth/callback`
4. **Auth > Email Templates:** Confirm redirect URLs are not `localhost:3000`

## Pages That Exist

- `/login` — Supabase email/password login
- `/signup` — Account creation
- `/auth/callback` — Handles Supabase redirect after email confirmation
- `/account` — User account page (shows tier, manage subscription)
- `/pricing` — Feature matrix display
- `/stock/[symbol]` — Individual stock page with premium hydration
- `/browse/all` — Stock browser with filters
- `/watchlist` — User watchlist (localStorage + API)
