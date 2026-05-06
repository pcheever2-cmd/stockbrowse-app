#!/usr/bin/env bash
# check-leakage.sh — premium data leakage canary
#
# Scans a directory for any premium field name that should never appear in
# public-tier static HTML or static data. Run as part of the build pipeline:
# if this script exits non-zero, the build must fail.
#
# Usage:
#   bash scripts/check-leakage.sh dist                  # scan built HTML
#   bash scripts/check-leakage.sh src/data/stocks-public.json  # scan public data file
#
# The list of premium fields below MUST be kept in sync with the PUBLIC_FIELDS
# allowlist in /Users/pcheev/Documents/Stock\ Research\ V2/export_website_stocks.py
# Anything NOT in PUBLIC_FIELDS is premium and must not leak into static output.

set -euo pipefail

TARGET="${1:-dist}"

if [ ! -e "$TARGET" ]; then
  echo "check-leakage: target '$TARGET' does not exist"
  exit 2
fi

# Premium field names (must not appear in static output)
# These are the JSON keys that come out of stocks-premium.json
PREMIUM_FIELDS=(
  "moonshotScore"
  "factorValues"
  "avgPriceTarget"
  "upside"
  "recentRatings"
  "analystPriceTargets"
  "evEbitda"
  "forwardPe"
  "sectorPe"
  "pegRatio"
  "epsGrowth"
  "revenueGrowth"
  "piotroskiScore"
  "altmanZ"
  "rsi"
  "sma50"
  "sma200"
  "trendSignal"
  "valueScore"
  "longTermScore"
  "valuationScore"
  "valuationRating"
  "valuationData"
  "sectorAnalystAccuracy"
  "coveringAnalysts"
)

LEAKED=()
for field in "${PREMIUM_FIELDS[@]}"; do
  # -r recursive, -q quiet, -l list files (we want first hit), --include filters by name
  # We scan .html and .json files. Astro emits HTML; static data files are .json.
  if grep -rqI --include="*.html" --include="*.json" "\"$field\"" "$TARGET" 2>/dev/null \
   || grep -rqI --include="*.html" --include="*.json" "\.$field" "$TARGET" 2>/dev/null; then
    LEAKED+=("$field")
  fi
done

if [ ${#LEAKED[@]} -gt 0 ]; then
  echo ""
  echo "============================================================"
  echo "  LEAKAGE CANARY FAILED"
  echo "============================================================"
  echo "  Premium field(s) found in '$TARGET':"
  for field in "${LEAKED[@]}"; do
    echo "    LEAK: $field"
    # Show the first occurrence so devs can locate it
    grep -rIl --include="*.html" --include="*.json" -e "\"$field\"" -e "\.$field" "$TARGET" 2>/dev/null | head -3 | sed 's/^/      → /'
  done
  echo ""
  echo "  These fields belong in stocks-premium.json and must be"
  echo "  fetched at runtime via /api/stocks/premium with auth."
  echo "  See export_website_stocks.py PUBLIC_FIELDS for the allowlist."
  echo "============================================================"
  exit 1
fi

echo "check-leakage: OK — no premium field leaks in '$TARGET'"
