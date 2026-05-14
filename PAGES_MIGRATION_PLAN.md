# Cloudflare Pages Migration Plan

## Session Summary (May 5–14, 2026)

### What Was Completed

**1. Fixed the CI Pipeline (stock-research repo)**
- Pipeline had been broken since April 4 (33+ consecutive failures)
- Root cause: commit `0c0bc5e` added `export_website_stocks.py` to CI, which queried `analyst_sector_accuracy` table that didn't exist in CI's `backtest.db`
- Fixed `export_website_stocks.py` — graceful fallback if analyst accuracy tables missing
- Fixed `parse_analyst_firms()` — NaN float values caused `AttributeError` on `.split()`
- Fixed `compute_compass_scores.py` and `compute_moonshot_scores.py` — empty DataFrame guards when no fundamental data
- Added `analyst_accuracy` + `analyst_sector_accuracy` table schemas to `setup_database.py`
- Added `setup_database.py` step to compass-scores workflow
- Fixed NaN in JSON output — Python's `json.dumps` outputs `NaN` which is invalid JSON, broke Vite/Astro builds. Added `sanitize_nans()` function
- Pipeline now runs daily successfully (May 8–14 all green)

**2. Seeded Fundamental Data for CI**
- Created `scripts/export_ci_backtest.py` — extracts needed tables from the 4.9GB local `backtest.db` into a ~530MB trimmed version for CI
- Uploaded to GitHub release as `backtest.db`
- Added upload guard — checks fundamental record count before clobbering release data
- Both workflows now push all 3 JSON files (`stocks.json`, `stocks-public.json`, `stocks-premium.json`) to the site repo

**3. Premium Tier Implementation (compass-score-site repo)**
- Implemented premium data split: `stocks-public.json` (SSG) + `stocks-premium.json` (KV)
- Populated Cloudflare KV (`STOCKS_PREMIUM_KV`) with 4,409 stocks via `scripts/sync-kv.sh`
- Added KV sync step to both CI workflows (1 API call per sync via bulk put)
- Built client-side hydration in `[symbol].astro` — fetches premium data from `/api/stocks/premium` and updates DOM elements for all premium fields
- Replaced N/A with 🔒 lock icons for free users
- Updated leakage canary to allow `data-premium` hydration attributes
- Added `?dev=1` bypass for developer testing
- Created Supabase account (pcheever2@gmail.com) with pro tier

**4. Cloudflare Deploy Configuration**
- Fixed multiple build failures (NaN JSON, leakage canary, wrangler config)
- Site builds and deploys successfully as a Worker with static assets

### Issues Encountered

**1. `backtest.db` disappeared from release**
- The 530MB upload from CI sometimes hit the 4-hour GitHub Actions timeout
- The daily pipeline's upload guard (checking fundamental records) was correct but couldn't help if the DB was deleted mid-upload
- Had to re-upload from local machine twice

**2. NaN values in JSON broke Astro/Vite build**
- Python's `json.dumps` happily outputs `NaN` (not valid JSON)
- Node/Vite correctly rejects it — caused all Cloudflare builds to fail since May 6
- Fixed with `sanitize_nans()` recursive cleaner

**3. Cloudflare Worker vs Pages — the blocking issue**
- The site was created as a Cloudflare Worker, not a Pages project
- Workers deploy static assets only — the `functions/` directory is ignored
- All API routes (`/api/stocks/premium`, `/api/auth/me`, etc.) return 404
- Attempted to switch to `npx wrangler pages deploy dist` but:
  - "Project not found" — no Pages project exists with that name
  - Authentication errors — token didn't have Pages permissions
  - Config conflicts between `[assets]` (Workers) and `pages_build_output_dir` (Pages)
- **This is the remaining blocker** — requires creating a new Pages project (see plan below)

**4. Supabase auth redirect URL**
- Email confirmation links redirect to `localhost:3000` instead of `app.stockbrowse.co`
- Needs to be updated in Supabase dashboard > Authentication > URL Configuration

**5. SITE_DEPLOY_TOKEN expired**
- The GitHub token for pushing to stockbrowse-app expired after 30 days
- Regenerated and updated

### Key Files Modified

**stock-research repo:**
- `.github/workflows/daily-pipeline.yml` — KV sync, upload guard, push all 3 JSONs
- `.github/workflows/compass-scores.yml` — setup_database step, KV sync, push all 3 JSONs
- `export_website_stocks.py` — NaN sanitizer, analyst accuracy fallback, parse_analyst_firms fix
- `compute_compass_scores.py` — empty DataFrame guard, quantile-based top scores
- `compute_moonshot_scores.py` — empty DataFrame guard, division by zero fix
- `setup_database.py` — analyst accuracy table schemas
- `scripts/export_ci_backtest.py` — new script for trimmed CI database

**compass-score-site repo:**
- `src/pages/stock/[symbol].astro` — data-premium attributes, hydration JS, lock icons
- `functions/api/stocks/premium.ts` — dev bypass
- `scripts/sync-kv.sh` — KV bulk upload script
- `scripts/check-leakage.sh` — exclude data-premium attributes
- `wrangler.toml` — various config attempts (settled on Worker deploy for now)

---

## Problem

The stockbrowse-app is deployed as a **Cloudflare Worker** (static assets only). The `functions/` directory containing API endpoints is ignored during Worker deploys. This means:

- `/api/stocks/premium` — 404 (premium data hydration broken)
- `/api/auth/me` — 404 (login/session broken)
- `/api/checkout` — 404 (Stripe payments broken)
- `/api/watchlists` — 404 (watchlists broken)
- `/api/webhooks/stripe` — 404 (subscription webhooks broken)

**All serverless API functionality is non-operational.** The static site works fine.

## Root Cause

The project was created as a Worker (`npx wrangler deploy`), not a Pages project (`npx wrangler pages deploy`). Pages projects automatically deploy the `functions/` directory as serverless endpoints. Workers don't.

## What's Already Done

- `functions/` directory with all API endpoints exists and is committed
- `_middleware.ts` with auth helpers is written
- KV namespace `STOCKS_PREMIUM_KV` exists and is populated with 4,409 stocks
- Supabase auth is configured (user account exists with pro tier)
- Hydration JS in `[symbol].astro` is ready to populate premium fields
- Leakage canary updated to allow `data-premium` attributes
- All Supabase secrets are set in the current Worker's build config

## Migration Steps

### Step 1: Create a New Pages Project

1. Go to Cloudflare dashboard > Workers & Pages > **Create**
2. Select **Pages** > **Connect to Git**
3. Select GitHub account `pcheever2-cmd` and repo `stockbrowse-app`
4. Set **Production branch** to `main`
5. Configure build settings:
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - **Root directory:** `/`
6. **Do NOT deploy yet** — configure environment first

> **Note:** The project name `stockbrowse-app` should work even though a Worker with the same name exists — they're different resource types. If Cloudflare rejects the name, use `stockbrowse-app-pages` temporarily and rename after deleting the old Worker.

### Step 2: Configure Environment Variables & Bindings

In the new Pages project settings, add these variables (Production environment):

**Plain text variables** (non-sensitive, needed at build time):
| Name | Value |
|------|-------|
| `PUBLIC_SUPABASE_URL` | `https://jyadpvwxedqvqlrsghzy.supabase.co` |
| `PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable_mWnsNqWDuUYfbdDJrr5u6w_bzFwgQDk` |

**Secrets** (sensitive, needed at runtime by Functions):
| Name | Value |
|------|-------|
| `SUPABASE_URL` | `https://jyadpvwxedqvqlrsghzy.supabase.co` |
| `SUPABASE_ANON_KEY` | `sb_publishable_mWnsNqWDuUYfbdDJrr5u6w_bzFwgQDk` |
| `SUPABASE_SERVICE_ROLE_KEY` | (get from `.dev.vars` in compass-score-site) |
| `STRIPE_SECRET_KEY` | (set when ready for payments) |
| `STRIPE_WEBHOOK_SECRET` | (set when ready for payments) |

> **Tip:** You can import variables from the old Worker via the dashboard or wrangler CLI to avoid re-entering them.

**KV namespace binding:**
- Variable name: `STOCKS_PREMIUM_KV`
- KV namespace: select the existing namespace (ID: `a16202c79b5b4372b3a686d6a4f8baf1`)

### Step 3: Update wrangler.toml

```toml
name = "stockbrowse-app"
compatibility_date = "2025-01-01"
pages_build_output_dir = "./dist"

[[kv_namespaces]]
binding = "STOCKS_PREMIUM_KV"
id = "a16202c79b5b4372b3a686d6a4f8baf1"
```

**Important:** Remove the entire `[assets]` section and any Worker-specific config. Pages uses `pages_build_output_dir` instead. If you add D1, R2, or other bindings later, add them here too.

### Step 4: Deploy and Verify Functions on Preview URL

1. Trigger a deployment in the new Pages project
2. The build will run `npm run build`, then Pages automatically compiles `functions/` into serverless endpoints
3. **Before moving the domain**, verify API routes work on the `.pages.dev` preview URL:
   - `GET <project>.pages.dev/api/stocks/premium?symbol=AAPL&dev=1` — should return JSON with premium data
   - `GET <project>.pages.dev/api/auth/me` — should return 401 (not 404)
   - Visit `<project>.pages.dev/stock/aapl/?dev=1` — premium fields should hydrate
4. If any endpoint returns 404, check that `functions/` directory is included in the build output and secrets are set

### Step 5: Move the Domain (most sensitive step)

**Sequence matters — do this in order:**

1. **Test first:** Verify everything works on the `.pages.dev` URL (Step 4)
2. In the **old Worker project** > Domains & Routes > **Remove** `app.stockbrowse.co`
3. In the **new Pages project** > Custom domains > **Add** `app.stockbrowse.co`
4. DNS is already Cloudflare-managed, so propagation should be near-instant
5. Verify `app.stockbrowse.co` serves the Pages version (check API routes)

### Step 6: Delete the Old Worker

Once the Pages project is serving traffic correctly:
1. Verify the site works at `app.stockbrowse.co`
2. Verify API endpoints return proper responses (not 404)
3. Delete the old `stockbrowse-app` Worker project
4. Update any internal bookmarks/docs pointing to the old project in the Cloudflare dashboard

### Step 7: Update CI Configuration

The stock-research CI pipeline pushes JSON to the git repo (which triggers Pages auto-build) and syncs KV. Verify:

1. `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets in the stock-research repo still work for KV sync
2. The `SITE_DEPLOY_TOKEN` (GitHub PAT) still has push access to `stockbrowse-app` repo
3. Trigger a manual pipeline run and confirm:
   - JSON files pushed to site repo
   - Cloudflare Pages auto-builds from the push
   - KV sync completes
4. Monitor the first few daily pipeline runs after migration

### Step 8: Fix Supabase Auth Redirect

In the Supabase dashboard (project `jyadpvwxedqvqlrsghzy`):
1. **Authentication > URL Configuration**
2. Set **Site URL** to `https://app.stockbrowse.co`
3. Add to **Redirect URLs**:
   - `https://app.stockbrowse.co/auth/callback`
   - Any `.pages.dev` preview URLs you want to test with
4. Test: sign up with a new email, confirm the link goes to `app.stockbrowse.co` (not `localhost:3000`)

### Step 9: Remove dev=1 Bypass (after auth works)

Once login and premium access work properly:
1. Remove `?dev=1` bypass from `functions/api/stocks/premium.ts`
2. Remove dev bypass logic from `src/pages/stock/[symbol].astro`
3. Test that logged-in Pro users see premium data without `?dev=1`
4. Test that free/logged-out users see lock icons

## Verification Checklist

After migration, test each endpoint:

- [ ] `app.stockbrowse.co/stock/aapl/?dev=1` — premium fields hydrate (EV/EBITDA, P/E, RSI, etc.)
- [ ] `app.stockbrowse.co/api/stocks/premium?symbol=AAPL&dev=1` — returns JSON with premium data
- [ ] `app.stockbrowse.co/api/auth/me` — returns 401 (not 404)
- [ ] `app.stockbrowse.co/signup` — creates account, confirmation email links to live site (not localhost)
- [ ] `app.stockbrowse.co/login` — authenticates and sets session
- [ ] Premium fields show for logged-in Plus/Pro users without `?dev=1`
- [ ] Free users see lock icons
- [ ] `app.stockbrowse.co/browse/all` — stock list loads correctly
- [ ] Daily pipeline pushes stock data and triggers successful Pages build
- [ ] KV sync completes in CI (check workflow logs)
- [ ] After removing dev bypass: Pro users see data, free users see locks

## Files Involved

- `wrangler.toml` — needs update (remove `[assets]`, add `pages_build_output_dir`)
- `functions/_middleware.ts` — auth helpers, CORS (no changes needed)
- `functions/api/stocks/premium.ts` — premium data endpoint (remove dev bypass in Step 9)
- `functions/api/auth/me.ts` — session endpoint (no changes needed)
- `functions/api/checkout.ts` — Stripe checkout (no changes needed)
- `functions/api/watchlists/` — watchlist CRUD (no changes needed)
- `functions/api/webhooks/stripe.ts` — payment webhooks (no changes needed)
- `src/pages/stock/[symbol].astro` — premium hydration JS (remove dev bypass in Step 9)

## Estimated Time

~30-45 minutes if no complications. The code is all ready — this is purely a Cloudflare infrastructure change. The most sensitive step is the domain migration (Step 5), but since DNS is Cloudflare-managed it should be near-instant.
