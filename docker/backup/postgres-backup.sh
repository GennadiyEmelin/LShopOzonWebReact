#!/bin/sh
set -eu

mkdir -p /backups

while true; do
  timestamp="$(date -u +%Y%m%d_%H%M%S)"
  file="/backups/${POSTGRES_DB}_${timestamp}.sql.gz"

  echo "Creating PostgreSQL backup: ${file}"
  PGPASSWORD="${POSTGRES_PASSWORD}" pg_dump \
    -h postgres \
    -U "${POSTGRES_USER}" \
    -d "${POSTGRES_DB}" \
    --no-owner \
    --no-privileges \
    | gzip > "${file}"

  find /backups -type f -name "${POSTGRES_DB}_*.sql.gz" -mtime +"${BACKUP_KEEP_DAYS}" -delete
  echo "Backup finished. Sleeping ${BACKUP_INTERVAL_SECONDS}s."
  sleep "${BACKUP_INTERVAL_SECONDS}"
done
