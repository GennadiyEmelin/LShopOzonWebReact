#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f ".env" ]; then
  echo "Файл .env не найден. Скопируйте .env.example в .env и заполните секреты."
  exit 1
fi

echo "Обновляем код из GitHub..."
git pull --ff-only

echo "Пересобираем и запускаем контейнеры..."
docker compose -f docker-compose.prod.yml --env-file .env up -d --build

echo "Текущий статус контейнеров:"
docker compose -f docker-compose.prod.yml --env-file .env ps

echo "Готово. Если Caddy настроен, сайт доступен по домену."
