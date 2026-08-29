#!/usr/bin/env bash
# FleetView production backup.
#
# Takes a full pg_dump of the production database into ./backups/, verifies the
# resulting SQL is non-trivial, writes a checksum, and keeps the last 30 dumps.
#
# Run it before any schema change, and on a schedule until the database is on a
# plan with automated backups.
#
#   ./scripts-backup.sh
set -euo pipefail
umask 077
cd "$(dirname "$0")"

PGDUMP="${PGDUMP:-/opt/homebrew/opt/libpq/bin/pg_dump}"
[ -x "$PGDUMP" ] || PGDUMP="$(command -v pg_dump)" || { echo "pg_dump not found — set PGDUMP"; exit 1; }

set -a; . ./.env.local; set +a
: "${DATABASE_URL_UNPOOLED:?DATABASE_URL_UNPOOLED not set}"

mkdir -p backups
chmod 700 backups
OUT="backups/fleetview-erp-$(date +%Y%m%d-%H%M%S).sql"
"$PGDUMP" "$DATABASE_URL_UNPOOLED" --no-owner --no-privileges -f "$OUT"

# A dump that exists but is empty is worse than no dump, because it looks fine.
TABLES=$(grep -c '^CREATE TABLE' "$OUT" || true)
if [ "$TABLES" -lt 10 ]; then
  echo "FAILED: only $TABLES tables in $OUT — not a usable backup"
  rm -f -- "$OUT"
  exit 1
fi

CHECKSUM="${OUT}.sha256"
shasum -a 256 "$OUT" > "$CHECKSUM"

# Filenames sort chronologically, so this is portable across macOS and GNU
# userlands (unlike `xargs -r`, which macOS does not support). Remove the
# checksum together with its dump; neither should survive alone.
kept=0
while IFS= read -r old; do
  kept=$((kept + 1))
  if [ "$kept" -gt 30 ]; then
    rm -f -- "$old" "${old}.sha256"
  fi
done < <(find backups -maxdepth 1 -type f -name 'fleetview-erp-*.sql' -print | sort -r)

echo "Backup OK: $OUT ($TABLES tables, $(du -h "$OUT" | cut -f1); sha256: $CHECKSUM)"
