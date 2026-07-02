#!/usr/bin/env bash
set -euo pipefail
cd /root/app
docker compose -f docker-compose.prod.yml --env-file .env exec -T postgres psql -U lshop -d lshop_ozon <<'SQL'
SELECT COUNT(*) AS satu_products FROM "SatuProducts";
SELECT * FROM "SatuSyncStates";
SELECT "MigrationId" FROM "__EFMigrationsHistory" ORDER BY "MigrationId";
SELECT character_maximum_length FROM information_schema.columns WHERE table_name='ProductionAnalyticsTaskRecords' AND column_name='ItemsJson';
SQL
docker compose -f docker-compose.prod.yml --env-file .env logs app --tail 60
