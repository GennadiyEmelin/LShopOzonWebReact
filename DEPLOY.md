# Деплой LShopOzonWebReact

Production-схема сделана через Docker Compose: один контейнер с ASP.NET Core + собранным React и отдельный контейнер PostgreSQL. Данные базы лежат в Docker volume `postgres_data`, поэтому при обновлении приложения не удаляются.

## Первый запуск на сервере

1. Установить Docker и Docker Compose.
2. Скопировать проект на сервер.
3. Создать файл `.env` из примера:

```bash
cp .env.example .env
```

4. Заполнить в `.env` пароли, JWT_KEY и Ozon API.
5. Запустить:

```bash
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
```

Сайт будет доступен на порту из `APP_PORT`, по умолчанию `8080`.

## Обновление проекта

1. Загрузить новую версию кода на сервер.
2. Пересобрать и перезапустить приложение:

```bash
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
```

Если в проекте появились новые миграции EF Core, приложение применит их само при старте. База не пересоздается, пока не удален volume `postgres_data`.

## Резервная копия базы

Перед крупным обновлением лучше сделать дамп:

```bash
docker compose -f docker-compose.prod.yml --env-file .env exec postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > backup.sql
```

## Важно

- Не хранить реальный `.env` в GitHub.
- Не удалять volume `postgres_data`, если нужно сохранить данные.
- Для домена и HTTPS лучше поставить Nginx/Caddy перед приложением и проксировать на `APP_PORT`.
