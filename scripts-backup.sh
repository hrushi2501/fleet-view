#!/usr/bin/env bash
# FleetView production backup.
#
# Takes a full pg_dump of the production database into ./backups/ and verifies
# the file is non-trivial before reporting success. Keeps the last 30 dumps.
#
# Run it before any schema change, and on a schedule until the database is on a
# plan with automated backups.
#
#   ./scripts-backup.sh
set -euo pipefail
cd "$(dirname "$0")"

PGDUMP="${PGDUMP:-/opt/homebrew/opt/libpq/bin/pg_dump}"
[ -x "$PGDUMP" ] || PGDUMP="$(command -v pg_dump)" || { echo "pg_dump not found — set PGDUMP"; exit 1; }

set -a; . ./.env.local; set +a
: "${DATABASE_URL_UNPOOLED:?DATABASE_URL_UNPOOLED not set}"

mkdir -p backups
OUT="backups/fleetview-erp-$(date +%Y%m%d-%H%M%S).sql"
"$PGDUMP" "$DATABASE_URL_UNPOOLED" --no-owner --no-privileges -f "$OUT"

# A dump that exists but is empty is worse than no dump, because it looks fine.
TABLES=$(grep -c '^CREATE TABLE' "$OUT" || true)
if [ "$TABLES" -lt 10 ]; then
  echo "FAILED: only $TABLES tables in $OUT — not a usable backup"
  exit 1
fi

echo "Backup OK: $OUT ($TABLES tables, $(du -h "$OUT" | cut -f1))"
ls -1t backups/*.sql | tail -n +31 | xargs -r rm --
