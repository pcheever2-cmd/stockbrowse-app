# Site Backlog — Items to Address

## Scoring Pipeline (stock-research repo)

- [ ] **Negative asset growth grade cap** — Stocks with negative asset growth (shrinking assets) can still score A. Consider capping at grade C maximum in `compute_compass_scores.py`, matching how the pipeline already caps the value at 0 for z-score calculation.

## Cloudflare / Infrastructure

- [ ] **Connect Cloudflare Pages to GitHub for auto-deploy** — Currently the only deploy path is `wrangler pages deploy` from CI or local. If the Pages project were connected to the GitHub repo, pushes would auto-trigger builds as a backup.

- [ ] **CI pipeline takes ~40 min for a full run** — Investigate decoupling the data pipeline from the site deploy. Could split into: (1) data export + push to repo, (2) separate fast deploy workflow triggered by the push.

## Display / UX

- [ ] **Moonshot grade letter is in public data** — Currently `moonshotGrade` is in `stocks-public.json` and visible in browse page cards (e.g., "AM" badge). If the grade should be premium-only, need to move it to premium export and hide from browse cards for free users.

- [ ] **Supabase auth redirect URL** — Email confirmation links redirect to `localhost:3000` instead of `app.stockbrowse.co`. Update in Supabase dashboard > Authentication > URL Configuration.

- [ ] **Remove dev=1 bypass** — Once auth + premium access work end-to-end, remove `?dev=1` bypass from `functions/api/stocks/premium.ts` and hydration JS in `[symbol].astro`.

- [ ] **Exclude /api/* from Zero Trust** — API calls from client-side JS on `app.stockbrowse.co` fail because Zero Trust intercepts them. Add a bypass rule for `/api/` paths (they have their own Supabase auth).

## Future Features

- [ ] **Per-analyst price targets in Analyst Track Record** — Show each covering analyst's individual price target alongside their rating and accuracy. Data exists in `analystPriceTargets` field and `price_target_summary` table but needs enrichment in `export_website_stocks.py` to map targets to specific firms.

- [ ] **Stock price chart** — Interactive price chart on stock detail pages. 1-year chart for Free users, 5-year chart for Plus+. Could use lightweight charting library (e.g., lightweight-charts by TradingView) with data from FMP historical prices already in backtest.db.

- [ ] **"Investor" premium tier** — Premium tier above Pro for serious investors. Includes full FMP data passthrough: quarterly financials (income statement, balance sheet, cash flow), earnings call transcripts, SEC filings, insider transactions, institutional holdings. Priced significantly higher ($50-100/mo) to offset FMP API costs per user.
