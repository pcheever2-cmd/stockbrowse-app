#!/usr/bin/env bash
# Sync stocks-premium.json into Cloudflare KV (STOCKS_PREMIUM_KV)
#
# Converts the symbol-keyed JSON dict into KV bulk format:
#   [{"key": "stock:AAPL", "value": "{...}"}, ...]
#
# Usage:
#   bash scripts/sync-kv.sh                          # uses src/data/stocks-premium.json
#   bash scripts/sync-kv.sh path/to/premium.json     # custom path

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PREMIUM_JSON="${1:-$PROJECT_DIR/src/data/stocks-premium.json}"
KV_NAMESPACE_ID="a16202c79b5b4372b3a686d6a4f8baf1"

if [ ! -f "$PREMIUM_JSON" ]; then
  echo "ERROR: $PREMIUM_JSON not found"
  exit 1
fi

echo "Converting stocks-premium.json to KV bulk format..."

# Python one-liner to convert {symbol: data} → [{key: "stock:SYM", value: "json"}, ...]
# Wrangler bulk put accepts max 10,000 pairs per call, so we chunk
python3 -c "
import json, sys, tempfile, os

with open('$PREMIUM_JSON') as f:
    data = json.load(f)

pairs = [{'key': f'stock:{sym}', 'value': json.dumps(val)} for sym, val in data.items()]
print(f'  {len(pairs)} stocks to upload')

# Wrangler bulk put supports up to 10,000 keys per call
CHUNK_SIZE = 10000
chunks = [pairs[i:i+CHUNK_SIZE] for i in range(0, len(pairs), CHUNK_SIZE)]

for i, chunk in enumerate(chunks):
    path = f'/tmp/kv_bulk_{i}.json'
    with open(path, 'w') as f:
        json.dump(chunk, f)
    print(f'  Chunk {i+1}/{len(chunks)}: {len(chunk)} keys → {path}')
"

echo "Uploading to KV namespace $KV_NAMESPACE_ID..."
for chunk_file in /tmp/kv_bulk_*.json; do
  npx wrangler kv bulk put "$chunk_file" --namespace-id "$KV_NAMESPACE_ID" --remote
  rm "$chunk_file"
done

echo "KV sync complete."
