#!/usr/bin/env bash
# Usage:
#   ./scrape_month.sh                  # current month
#   ./scrape_month.sh 2026 04          # specific month

set -euo pipefail

SECRET="${ADMIN_SECRET:-}"
URL="https://capas.digasnikas.com/api"
YEAR="${1:-$(date +%Y)}"
MONTH="${2:-$(date +%m)}"

if [[ -z "$SECRET" ]]; then
  echo "Error: set ADMIN_SECRET env var or edit this script."
  exit 1
fi

echo "Scraping $(printf '%04d-%02d' "$YEAR" "$MONTH")..."
echo ""

# Use Python for cross-platform date math — generates one "START END" line per 7-day batch
while IFS=' ' read -r START END; do
  echo -n "  $START → $END ... "
  RESPONSE=$(curl -s -X POST -o - -w "\n%{http_code}" \
    -A "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36" \
    -H "Authorization: Bearer $SECRET" \
    "$URL/scrape?start=$START&end=$END")
  HTTP_CODE=$(echo "$RESPONSE" | tail -1)
  BODY=$(echo "$RESPONSE" | head -1)
  echo "$HTTP_CODE: $BODY"
  sleep 2
done < <(python3 - "$YEAR" "$MONTH" <<'EOF'
import sys
from datetime import date, timedelta
year, month = int(sys.argv[1]), int(sys.argv[2])
first = date(year, month, 1)
last  = date(year + month // 12, month % 12 + 1, 1) - timedelta(days=1)
d = first
while d <= last:
    w = min(d + timedelta(days=6), last)
    print(d.strftime("%Y%m%d"), w.strftime("%Y%m%d"))
    d = w + timedelta(days=1)
EOF
)

echo ""
echo "Done."
