#!/bin/sh
# Restore a dump made by backup.sh into the compose `db` service (pg_restore --clean --if-exists).
# Usage: infra/restore.sh [-y] <path/to/finhub-*.dump>
# DESTRUCTIVE: replaces the current contents of the database. Stop the app first:  docker compose stop app
set -eu

assume_yes=0
if [ "${1:-}" = "-y" ]; then
  assume_yes=1
  shift
fi
if [ "$#" -ne 1 ]; then
  echo "usage: $0 [-y] <dump-file>" >&2
  exit 2
fi
dump="$1"
[ -f "$dump" ] || { echo "no such file: $dump" >&2; exit 1; }
# resolve before changing directory so relative paths keep working
dump="$(cd "$(dirname "$dump")" && pwd)/$(basename "$dump")"

cd "$(dirname "$0")/.."
DB_SERVICE="${DB_SERVICE:-db}"
DB_USER="${POSTGRES_USER:-finhub}"
DB_NAME="${POSTGRES_DB:-finhub}"

if [ "$assume_yes" -ne 1 ]; then
  printf 'This will OVERWRITE database "%s" with %s. Type "yes" to continue: ' "$DB_NAME" "$dump"
  read -r answer
  [ "$answer" = "yes" ] || { echo "aborted" >&2; exit 1; }
fi

docker compose exec -T "$DB_SERVICE" pg_restore --clean --if-exists --no-owner -U "$DB_USER" -d "$DB_NAME" <"$dump"
echo "restore complete"
