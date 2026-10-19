#!/usr/bin/env bash
# One-shot Cloudflare deploy: D1 database + schema, R2 bucket, Worker (API + cron), then prints the URLs.
# Prereq: `npx wrangler login` done once (or CLOUDFLARE_API_TOKEN set). Re-running is safe.
set -euo pipefail
cd "$(dirname "$0")"
W="npx --yes wrangler@4"
DB=netflix-comments
BUCKET=netflix-comments-snapshots

echo "== D1"
if ! $W d1 list --json 2>/dev/null | grep -q "\"name\": *\"$DB\""; then $W d1 create "$DB" >/dev/null; fi
DB_ID=$($W d1 list --json 2>/dev/null | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const x=JSON.parse(d).find(r=>r.name===process.argv[1]);console.log(x?x.uuid:"")})' "$DB")
[ -n "$DB_ID" ] || { echo "could not resolve D1 id"; exit 1; }
sed -i '' "s|database_id = \".*\"|database_id = \"$DB_ID\"|" wrangler.toml
echo "   id $DB_ID"
$W d1 execute "$DB" --remote --file=schema.sql >/dev/null && echo "   schema applied"

echo "== R2"
if ! $W r2 bucket list 2>/dev/null | grep -q "name: *$BUCKET"; then
  $W r2 bucket create "$BUCKET" 2>&1 | grep -v "Unsupported macOS" | grep -E "Created|ERROR|enable R2" || true
fi
echo "   bucket $BUCKET  (if this said 'enable R2', do that once in the dashboard and re-run)"

echo "== Worker"
OUT=$($W deploy 2>&1 | grep -v "Unsupported macOS")
echo "$OUT" | grep -E "https://|Deployed|Current Version" || echo "$OUT"
URL=$(echo "$OUT" | grep -o 'https://[a-z0-9.-]*workers\.dev' | head -1)

echo
echo "== Done"
echo "write URL (API):  ${URL:-<see above>}"
echo "read URL:         same Worker serves /t/* from R2 when SERVE_SNAPSHOTS=true (set in wrangler.toml [vars])."
echo "                  For the zero-cost read path, give the R2 bucket a public custom domain and use that instead."
echo "health:           curl ${URL:-<url>}/api/health"
