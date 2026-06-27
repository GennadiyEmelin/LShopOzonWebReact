# Откат до разделения LShop РФ / KZ

Перед началом работы над вкладкой KZ создана точка восстановления.

## Git tag

```bash
git checkout backup-before-kz-split-2026-06-23
```

Или ветка:

```bash
git checkout backup/before-kz-split-2026-06-23
```

## Вернуть main к состоянию до KZ

```bash
git reset --hard backup-before-kz-split-2026-06-23
```

После отката пересоберите Docker:

```bash
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
```
