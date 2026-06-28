# Откат до архитектурного рефакторинга

Перед промышленным рефакторингом (июнь 2026) создана точка восстановления.

## Git tag

```bash
git checkout pre-architecture-refactor-2026-06-23
```

Или ветка:

```bash
git checkout backup/pre-architecture-refactor-2026-06-23
```

## Вернуть main к состоянию до рефакторинга

```bash
git reset --hard pre-architecture-refactor-2026-06-23
```

После отката пересоберите Docker:

```bash
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
```

## Предыдущая точка (до KZ)

См. также `backup-before-kz-split-2026-06-23` / `backup/before-kz-split-2026-06-23`.
