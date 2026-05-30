# Session Summary — May 29, 2026

> Handoff doc to start a fresh chat with full context. The headline project is
> **"Search like Amazon" — semantic, theme-based stock discovery.** As of this
> session the **Curated Theme Catalog is LIVE with 540 themes** (the forward plan
> from the prior summary is now built and shipped).

---

## 🟢 LIVE NOW — Curated Theme Catalog (540 themes)

Type a meaning/interest into the browse search box → curated stock picks with a
one-line "why", ranked by similarity × Compass Score.
- **Test:** https://stockbrowse-app-pages.pages.dev/browse/all/ (open `.pages.dev`, no Zero Trust wall)
- Try: `gold` · `ozempic` · `weed` · `f1` · `soccer` · `coffee` · `chinese stocks` ·
  `dividend aristocrats` · `heart disease` · `cobalt` · `recession proof`. A real
  ticker (`AAPL`) or company name still does a clean literal lookup. Off-catalog
  queries fall back to raw semantic search.

### The 540 themes (4 batches, all committed in `data/theme-catalog.json`)
1. **Sector themes (181):** GLP-1, AI chips, nuclear/SMR, cybersecurity, defense, EVs,
   semis, fintech, cloud, robotics, space, REITs, energy, materials, biotech…
2. **Interest/culture (170):** F1, soccer, NFL, golf, UFC, coffee, sneakers, pizza,
   motorcycles, holidays, supplements, tires… ("what's *behind* my hobby?")
3. **Batch 4 (189):** geography (China/India/Japan/Brazil/Europe ADRs), macro
   (inflation/recession-proof/tariffs/infrastructure), granular disease (cardio, NASH,
   autoimmune, oncology subtypes, ALS, MS…), AI/tech subthemes, niche services
   (staffing, reinsurance, debt collection…), commodities (cobalt/nickel/helium/PGM),
   values (ESG/sin/faith), demographics, **stable income lists** (Dividend
   Aristocrats/Kings, blue chips).

~4,600 curated picks, each {symbol, kind: direct|picks-shovels, why ≤10 words}.

### How it works (the pieces that exist)
- **Two Vectorize indexes** (768-dim, cosine): `stockbrowse-stocks` (6,678 stock
  description vectors, id=ticker) and `stockbrowse-themes` (~3,419 vectors = theme
  labels + aliases, id=`slug` or `slug::N`, metadata.slug → base slug).
- **`functions/api/search/semantic.ts`** — embeds the query once (Workers AI
  `bge-base-en-v1.5`), checks the themes index (topK=1, returnMetadata). If cosine ≥
  **`HIT_THRESHOLD` (0.80)** → **catalog hit**: serves the KV catalog entry's picks +
  why/kind. Else **miss**: logs it + queries the stocks index (raw semantic), as before.
  `similarTo:"NVDA"` path = per-stock neighbor lookup, unchanged. Always returns
  `themeScore`/`themeSlug` (calibration telemetry).
- **Alias vectors** = basic-word/brand entry points ("weed"→cannabis, "ozempic"→GLP-1,
  "f1"→Formula 1, "china"→Chinese stocks). All score ~0.96+. See [[feedback_basic_word_aliases]].
- **`functions/api/admin/catalog.ts`** — token-gated (`Bearer $REINDEX_SECRET`) bulk
  loader: accepts `{entries:[{theme, items, aliases}]}`, embeds label+aliases (chunked),
  upserts theme vectors + writes KV `catalog:<slug>`. Idempotent. **Call with a browser
  User-Agent** or Cloudflare 403s the request. POST in chunks of ~30 themes.
- **`functions/lib/search-cache.ts`** — `HIT_THRESHOLD`, catalog KV helpers, miss
  logging, monthly budget cap (dormant), `CatalogEntry` type.
- **Rate limiter** — Pages can't host the native `[[ratelimits]]` binding, so a
  standalone `workers/rate-limiter/` Worker (native rate-limit binding, 30/60s per IP)
  is bound to Pages via a `[[services]]` service binding.
- **Card render** — `src/pages/browse/all.astro` shows the why-line + Direct/Picks &
  shovels tag; price/Compass Score join to `allStocks` CLIENT-SIDE (so prices stay live
  and delisted names drop automatically).
- **Prices/scores apply LIVE at serve time** — the catalog stores only slow-changing
  {symbol, kind, why}; daily data refresh costs zero curation tokens.

### Threshold calibration (data-driven, re-run each batch)
At 540-theme density: basic-word/alias queries score ≥0.95, true negatives ≤0.71 — wide
gap, so **0.80 is precision-first** (no embarrassing false matches). Verbose paraphrases
that fall under 0.80 degrade to raw semantic. Re-probe + re-tune if the catalog grows.

---

## ✅ Also fixed this session (data-quality bugs in the `stock-research` repo)
Both shipped + realized via a triggered `compass-scores` CI re-run:
1. **asset_growth scorer cap** (`compute_compass_scores.py`) — the >500% extreme filter
   was NULLing legit high-growth names; now caps instead of excludes. Recovered ~106
   names incl. IONQ/QUBT (now in the catalog).
2. **Price-coverage hardening** (`run_pipeline_OPTIMIZED.py` + both CI workflows) —
   backfill now runs AUTO-DETECT (was `--lookback 7`, couldn't repair multi-week
   outages) and the daily update logs symbols batch-quote drops, so coverage erosion
   isn't silent. See [[reference_cloudflare_pages_gotchas]].

---

## ✅ SHIPPED (this session) — price chart + valuation overlays + auto read-out

Live on every stock detail page (the "Price History" card under Current Price / Market Cap):
a 5yr daily price chart, toggleable **P/E and EV/EBITDA overlays** with a forward-P/E
reference line, and a **plain-English valuation read-out** beneath it. All public.
- **Data:** new `scripts/export_prices_kv.py` (stock-research) streams ~5yr of DAILY closes
  per published symbol from `backtest.db` (`COALESCE(adjusted_close, close)`) into
  byte-chunked KV bulk files. Value shape = exactly what lightweight-charts wants:
  `[{ "time":"YYYY-MM-DD", "value":<num> }]` ascending. Key = `prices:SYM` in the SAME
  `STOCKS_PREMIUM_KV` namespace (`a162…baf1`) as `stock:SYM` (prefixed, no collision).
- **Serve:** `functions/api/stock/[symbol]/prices.ts` — **public** (no auth), pass-through
  of the KV string, `Cache-Control: public, max-age=3600`, returns `[]` for missing/thin →
  client hides the section.
- **Render:** `src/pages/stock/[symbol].astro` — `lightweight-charts` v5 `AreaSeries`
  (cyan), crosshair tooltip, 1M/6M/1Y/5Y/All range buttons (UTC `monthsBefore` clamp).
  Fetches client-side (page is SSG), reveals the section only on ≥2 points.
- **Daily refresh:** two steps added to `daily-pipeline.yml` — build the bulk files after
  the stocks export, then `wrangler kv bulk put` to the prices keyspace after the premium
  KV sync. So `prices:SYM` refreshes every weekday with the prior session's settled close
  (standard daily-chart behavior; the hourly `price-update.yml` only touches the headline
  price JSON, not KV). Export logs a **staleness warning** if the latest point >5d old.
### Valuation overlays (P/E + EV/EBITDA over time)
- **Data:** new `scripts/export_overlays_kv.py` computes DAILY trailing P/E and EV/EBITDA per
  symbol and the current forward-P/E scalar. Two correctness choices baked in: multiples use
  **RAW `close`** (not adjusted) + as-reported EPS/shares so they stay continuous across
  in-window splits (verified on NVDA's 2024 10:1 — no jump); fundamentals aligned to each
  price day by **`filing_date`** (merge_asof backward) to avoid look-ahead. TTM = rolling
  4-quarter sum from `historical_income_statements` / `historical_balance_sheets`. Emitted
  only where the denominator is positive (negative-earnings days gap). Key `overlays:SYM` =
  `{pe, evEbitda, fwdPe}` in the same KV namespace; byte-chunked bulk files.
- **Serve:** `functions/api/stock/[symbol]/overlays.ts` — **public** pass-through (decision:
  kept public as a free hook even though the snapshot values are premium elsewhere; gate
  later via `requireAuth('plus')` if desired — see the NOTE in that file).
- **Render:** overlay toggles in `[symbol].astro` add P/E (amber) + EV/EBITDA (violet)
  `LineSeries` on a shared **left axis (×)**, price stays on the right ($). Crosshair legend
  shows Price/P/E/EV-EBITDA at the hovered date; dashed **Fwd P/E** reference line via
  `createPriceLine`. Deep-link `?overlay=pe,evEbitda` pre-activates (shareable view).
- **Refresh:** two more steps in `daily-pipeline.yml` (export after prices, KV sync after the
  prices sync). ⚠️ KV bulk uploads are flaky over ~76MB files — if a chunk fails, split it
  (e.g. into thirds) and retry; smaller files go through.

### Auto valuation read-out (deterministic narrative)
- `[symbol].astro` renders a 3-sentence read-out under the chart, computed **client-side from
  the chart's own data** (no backend, no LLM, never stale, can't hallucinate): (1) decomposes
  the 1yr move into earnings growth vs multiple expansion, (2) places current P/E & EV/EBITDA
  in their 5yr percentile band, (3) reads the forward-vs-trailing P/E gap. Graceful fallbacks
  for negative-earnings / short-history names. Labeled "educational — not advice".

- **Status:** all committed to `main` — stock-research (`2050eed` prices, `1679cf9` overlays);
  stockbrowse-app (`06027df` chart, `4e3c341` overlays UI, `b082b0b` read-out). Deployed to
  prod; FULL KV seeded for prices (4,233) + overlays (3,783; 450 dropped for unprofitable/
  sparse fundamentals). Verified live with screenshots (AAPL "split / upper end", NVDA
  "earnings-driven / lower end"). Independent 2-reviewer pass on the price chart = SHIP.

**Possible follow-ups:** sector context in the read-out (use `sectorPe` we already compute);
split P/E and EV/EBITDA onto separate axes so re-ratings pop; Workers-AI prose polish of the
same computed signals (cached weekly, behind the budget cap); gate overlays behind Plus if the
free-hook call is revisited; dynamic-`import()` lightweight-charts to defer ~55KB.

---

## ⏭️ PARKED / OTHER NEXT STEPS
1. **MDT-type scorer robustness (user said "leave for now"):** real companies (Medtronic
   et al.) excluded because FMP returned a bad single-quarter `total_assets`, exploding
   ratios → extreme-value filter NULLs them. `compute_compass_scores.py` *flags*
   `is_asset_anomaly` (>80% QoQ swing) but still uses that quarter. Fix = skip anomalous
   quarters / use last good quarter. **Methodology change, affects the site-wide universe
   — get sign-off before shipping.** ~162 names hit extreme filters (only some are real
   data-errors vs genuinely-extreme micro-caps).
2. **Price-sparse names (EXAS/ABL etc.):** fundamentals fine but <30 recent prices AND
   FMP's `historical-price-eod` endpoint returns nothing for them — only daily batch-quote
   has them, so they self-heal ~1 row/day over ~30 days. Watch the universe count.
3. **Phase C** — curate-on-miss (verbose paraphrases under 0.80) via Workers AI Llama or
   Haiku behind the budget cap. **Phase D** — drift loop / weekly re-curation from top
   misses + news (the `miss:` KV counters already accumulate).
4. **Dynamic/screen searches we deliberately skipped:** dividend/value/growth-as-screens
   (better as browse filters) and Buffett/Pelosi/ARK 13F portfolios (better generated
   from holdings data, not a static catalog).
5. Show full company description on `/stock/[symbol]` (data's in production).

---

## 🗺️ Architecture & gotchas (don't relearn — also in [[reference_cloudflare_pages_gotchas]])
- **Two sites:** `stockbrowse-landing` → **stockbrowse.co** (marketing/SEO, blog home).
  `compass-score-site` (repo `stockbrowse-app`) → **app.stockbrowse.co** (the app, behind
  **Cloudflare Zero Trust** — use `.pages.dev` for testing).
- **Data pipeline:** `nasdaq_stocks.db` + `backtest.db` (fundamentals/prices) live in the
  GitHub **`data` release** of `stock-research` (NOT git-tracked; `gh release download data
  --pattern …`). `Stock Research V2/.github/workflows/daily-pipeline.yml` (cron 6 AM UTC
  weekdays) + `compass-scores.yml` (cron, also `workflow_dispatch`): download DBs →
  backfill prices → compute scores → `export_website_stocks.py` (`WHERE compass_score IS
  NOT NULL` — only scored stocks ship; ~4,233 of 6,678) → push JSON to compass-score-site
  → `wrangler pages deploy` → KV sync. **Local DB is usually STALE; never build+deploy
  from stale local data** (`git pull --rebase` first).
- **Catalog serves from KV/Vectorize, NOT a deployed file** → loading new themes via the
  admin endpoint makes them live with NO Pages deploy. The committed
  `data/theme-catalog.json` is the reproducible source of record (reload = idempotent).
- **Repos:** compass-score-site → `pcheever2-cmd/stockbrowse-app`; Stock Research V2 →
  `pcheever2-cmd/stock-research`; landing → `pcheever2-cmd/stockbrowse-landing`.
- **Gotchas:** Vectorize indexes upserts ASYNC (~30-60s; poll `wrangler vectorize info`).
  Vectorize caps topK with `returnMetadata` (safe at topK=1). `wrangler pages dev` can't
  run Vectorize. Preview deployments DON'T get prod secrets (test secret-gated endpoints
  on prod). Pages rejects native `[[ratelimits]]`. Default urllib UA gets 403'd — use a
  browser UA for endpoint calls. FMP rate limit 3,000/min.
- **wrangler is OAuth-authed** as pcheever2@gmail.com on this machine.

---

## 🔁 Reusable pipeline (how each catalog batch was built)
draft themes (sector dict + sub-queries) → **retrieve** candidates (live
`/api/search/semantic` per sub-query, browser UA, paced ≤30/min, join snippets from
`stocks-public.json`) → split into per-batch files → **curation Workflow** (~8 themes/agent,
schema `{theme, items[], aliases[]}`, relates-to framing + basic-word aliases, agents add
known names retrieval misses) → validate symbols vs universe → QC why-lines (≤10 words, no
hype) → MERGE into `theme-catalog.json` → chunked load → wait for indexing → recalibrate
threshold → validate (new + existing hit, negatives miss) → commit. Each batch ≈ 700K
curation tokens.

> Memory files (auto-loaded): `project_theme_catalog_status` (detailed state + parked
> items), `reference_cloudflare_pages_gotchas`, `feedback_basic_word_aliases`,
> `feedback_card_microcopy`, plus the existing voice/pipeline/two-site memories.
