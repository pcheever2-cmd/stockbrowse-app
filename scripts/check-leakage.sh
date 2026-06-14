#!/usr/bin/env bash
# check-leakage.sh — premium data leakage canary
#
# Scans a directory (or file) for any premium field name that must never appear
# in public-tier static output. Run as part of the build; non-zero exit = fail.
#
# Usage:
#   bash scripts/check-leakage.sh dist                         # scan built site
#   bash scripts/check-leakage.sh src/data/stocks-public.json  # scan public data
#
# The premium denylist is DERIVED, not hand-maintained, so it can't drift from
# the export: premium = (keys in stocks-premium.json ∪ flagship backstop) minus
# the public allowlist (keys in stocks-public.json). A self-test fails the build
# if a flagship field (fairValue, catalystScore, isGolden) isn't covered or if
# the public/premium sets overlap. Source of truth: PUBLIC_FIELDS in
# Stock Research V2/export_website_stocks.py.

set -euo pipefail

TARGET="${1:-dist}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PUB_JSON="$ROOT/src/data/stocks-public.json"
PREM_JSON="$ROOT/src/data/stocks-premium.json"

if [ ! -e "$TARGET" ]; then
  echo "check-leakage: target '$TARGET' does not exist"
  exit 2
fi

# --- Derive the premium denylist + self-test (Node; fails non-zero on any problem) ---
if ! FIELDS="$(node -e '
  const fs = require("fs");
  const readKeys = (p, perSymbol) => {
    const keys = new Set();
    try {
      const j = JSON.parse(fs.readFileSync(p, "utf8"));
      if (perSymbol) { for (const s of Object.keys(j)) for (const k of Object.keys(j[s] || {})) keys.add(k); }
      else { for (const row of (Array.isArray(j) ? j : [])) for (const k of Object.keys(row || {})) keys.add(k); }
    } catch (e) { /* file may be absent when scanning a built dir elsewhere */ }
    return keys;
  };
  const publicKeys = readKeys(process.argv[1], false);
  const premiumKeys = readKeys(process.argv[2], true);
  // Flagship backstop — always premium even if the sampled JSON is stale/thin.
  for (const k of ["fairValue","fairValueVerdict","catalystScore","catalystTag","catalystLabel",
    "isGolden","beatStreak","epsSurprisePct","netUpgrades180d","netUpgrades180dNorm",
    "upside","avgPriceTarget","factorValues"]) premiumKeys.add(k);
  const scan = [...premiumKeys].filter(k => !publicKeys.has(k)).sort();
  // Self-test: flagships must be in scan; public/premium must be disjoint.
  const missing = ["fairValue","catalystScore","isGolden"].filter(k => !scan.includes(k));
  const overlap = [...publicKeys].filter(k => scan.includes(k));
  if (missing.length || overlap.length) {
    console.error("check-leakage SELF-TEST FAIL: missing=[" + missing + "] overlap=[" + overlap + "]");
    process.exit(3);
  }
  if (publicKeys.size === 0) { console.error("check-leakage: could not read public keys from " + process.argv[1]); process.exit(3); }
  process.stdout.write(scan.join("\n"));
' "$PUB_JSON" "$PREM_JSON")"; then
  echo "check-leakage: premium field derivation / self-test failed"
  exit 3
fi

PREMIUM_FIELDS=()
while IFS= read -r line; do
  [ -n "$line" ] && PREMIUM_FIELDS+=("$line")
done <<< "$FIELDS"

# --- Assertion: full / premium data files must never ship in a built directory ---
if [ -d "$TARGET" ]; then
  if find "$TARGET" -type f \( -name "stocks.json" -o -name "stocks-premium.json" \) 2>/dev/null | grep -q .; then
    echo ""
    echo "  LEAKAGE CANARY FAILED: full/premium data file shipped in '$TARGET'"
    find "$TARGET" -type f \( -name "stocks.json" -o -name "stocks-premium.json" \) | sed 's/^/    → /'
    exit 1
  fi
fi

# --- Scan for premium field names ---
LEAKED=()
for field in "${PREMIUM_FIELDS[@]}"; do
  # Any premium field in static JSON is a real leak.
  if grep -rI --include="*.json" -e "\"$field\"" "$TARGET" 2>/dev/null | grep -q .; then
    LEAKED+=("$field")
  # In HTML, strip <script> blocks (runtime hydration/filter code references the
  # field names but not the values) and the data-* hydration markers.
  elif find "$TARGET" -name "*.html" -print0 2>/dev/null | xargs -0 \
       sed '/<script/,/<\/script>/d' 2>/dev/null \
       | grep -v 'data-premium=' \
       | grep -v 'data-factor-display=' \
       | grep -e "\"$field\"" -e "\.$field" 2>/dev/null | grep -q .; then
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
    grep -rIl --include="*.html" --include="*.json" -e "\"$field\"" -e "\.$field" "$TARGET" 2>/dev/null | head -3 | sed 's/^/      → /'
  done
  echo ""
  echo "  These fields belong in stocks-premium.json and must be"
  echo "  fetched at runtime via /api/stocks/premium with auth."
  echo "  See export_website_stocks.py PUBLIC_FIELDS for the allowlist."
  echo "============================================================"
  exit 1
fi

echo "check-leakage: OK — ${#PREMIUM_FIELDS[@]} premium fields checked, none leaked in '$TARGET'"
