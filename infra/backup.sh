#!/usr/bin/env bash
# Daily SQLite backup: a consistent copy of the server database, gzipped into
# $BACKUP_DIR (default ~/letopeiras-backups), keeping the newest $KEEP (default 7).
# Safe while the server is running. Schedule it with cron (see infra/README.md).
set -euo pipefail
cd "$(dirname "$0")"

BACKUP_DIR=${BACKUP_DIR:-$HOME/letopeiras-backups}
KEEP=${KEEP:-7}
name="letopeiras-$(date -u +%Y-%m-%dT%H%M%SZ).db"
tmp="/data/backup-tmp.db"

mkdir -p "$BACKUP_DIR"
docker compose exec -T server node dist/cli/backup.mjs "$tmp" >/dev/null
docker compose cp "server:$tmp" "$BACKUP_DIR/$name" >/dev/null 2>&1
docker compose exec -T server rm -f "$tmp"
gzip -f "$BACKUP_DIR/$name"

# Drop all but the newest $KEEP.
ls -1t "$BACKUP_DIR"/letopeiras-*.db.gz | tail -n +"$((KEEP + 1))" | xargs -r rm -f
echo "$(date -u +%FT%TZ) backup ok: $BACKUP_DIR/$name.gz"
