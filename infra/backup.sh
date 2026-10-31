#!/bin/sh
# Logical backup of the finhub database: pg_dump -Fc via the compose `db` service.
#   BACKUP_DIR      target directory (default: <repo>/backups)
#   RETENTION_DAYS  delete finhub-*.dump older than this (default: 30)
#   DB_SERVICE / POSTGRES_USER / POSTGRES_DB  compose service and database (defaults: db / finhub / finhub)
set -eu

cd "$(dirname "$0")/.."
BACKUP_DIR="${BACKUP_DIR:-backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
DB_SERVICE="${DB_SERVICE:-db}"
DB_USER="${POSTGRES_USER:-finhub}"
DB_NAME="${POSTGRES_DB:-finhub}"

mkdir -p "$BACKUP_DIR"
umask 077
stamp=$(date -u +%Y%m%dT%H%M%SZ)
out="$BACKUP_DIR/finhub-$stamp.dump"
tmp="$out.partial"
trap 'rm -f "$tmp"' EXIT INT TERM

docker compose exec -T "$DB_SERVICE" pg_dump -Fc -U "$DB_USER" "$DB_NAME" >"$tmp"
[ -s "$tmp" ] || { echo "backup failed: empty dump" >&2; exit 1; }
mv "$tmp" "$out"
echo "backup written: $out"

find "$BACKUP_DIR" -maxdepth 1 -type f -name 'finhub-*.dump' -mtime +"$RETENTION_DAYS" -exec rm -f {} +
echo "pruned dumps older than $RETENTION_DAYS days"
