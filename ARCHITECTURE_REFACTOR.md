# Architecture Refactor Report

**Project:** LShopOzonWebReact  
**Date:** 2026-06-23  
**Backup tag:** `pre-architecture-refactor-2026-06-23`  
**Branch:** `backup/pre-architecture-refactor-2026-06-23`

---

## 1. What was found

### Backend (~95 `.cs` files)

| Area | State |
|------|--------|
| `Program.cs` | **~6,030 lines** — 89 HTTP endpoints + ~1,750 lines DTOs/helpers |
| Routes already extracted | `IntegrationRoutes` (9), `KzMarketplaceRoutes` (7) |
| Domain folders | `Ozon/`, `Integrations/`, `Security/`, `Marketplaces/`, `Production/`, `Models/`, `Data/`, `Hubs/` |
| No `Services/` or `Endpoints/` (before refactor) | Business logic inline in minimal API handlers |
| SignalR | `AppHub` at `/hubs/live`, `ChatHub` static notifier |
| Hosted services | Telegram bot polling, daily reports |
| EF Core | 13 DbSets, **27 migrations** — do not change |
| Total HTTP surface | **105 endpoints** |

**Endpoint groups in Program.cs:**

| Prefix | Count |
|--------|------:|
| `/api/production` | 26 |
| `/api/admin` | 19 |
| `/api/chat` | 13 |
| `/api/supplies` | 12 |
| `/api/ozon` | 7 |
| `/api/auth` + setup | 5 |
| `/api/profile` | 3 |
| Other | 9 |

### Frontend (6 source files)

| File | Lines |
|------|------:|
| `App.tsx` | **~15,500** |
| `App.css` | **~7,270** |
| `shopRegion.ts` | 219 |
| `KzRegionUi.tsx` | 160 |
| `index.css` | 24 |

- ~100 `useState`, ~44 `useEffect`, ~90 fetch calls — all in `App.tsx`
- No global store, no feature folders
- Only region logic extracted (`shopRegion`, `KzRegionUi`)

### Docker

- Single `docker-compose.prod.yml` + root `Dockerfile`
- `docker/postgres-backup.sh` for backups
- Adminer bound to localhost by default

### Security (unchanged behavior)

- JWT Bearer + feature-based RBAC (`FeatureAccess`)
- PBKDF2 password hashing
- No refresh tokens (document for future)
- CORS: dev-only `localhost:5173`
- Upload paths via `AppPaths` helpers

---

## 2. What was fixed / started (Phase 1)

### Backend

| Change | Location |
|--------|----------|
| **Options classes** | `Configuration/JwtOptions`, `DatabaseOptions`, `HttpsOptions`, `AdminOptions` |
| **DI extraction** | `Extensions/DependencyInjectionExtensions.cs` |
| **Pipeline extraction** | `Extensions/ApplicationPipelineExtensions.cs` |
| **Auth endpoints extracted** | `Endpoints/AuthEndpoints.cs` (setup + login + me + heartbeat + logout) |
| **Auth DTOs** | `Contracts/Auth/AuthContracts.cs` |
| **AdminOptions** for system-health | `IOptions<AdminOptions>` instead of raw config strings |
| **Program.cs slimmed** | DI + middleware moved out; auth routes removed (~140 lines) |

**Build:** `dotnet build` ✅

### Frontend

| Change | Location |
|--------|----------|
| **API client helpers** | `shared/api/client.ts` (`getApiErrorMessage`, `apiFetch`, `authHeaders`) |
| **Formatters extracted** | `shared/utils/formatters.ts` (byte-identical behavior) |
| **App.tsx** | Imports from shared modules; duplicate functions removed |

**Build:** via Docker `compose build` ✅

### Phase 2 — Production (2026-06-23)

| Change | Location |
|--------|----------|
| **26 production endpoints** | `Endpoints/ProductionEndpoints.cs` |
| **Production DTOs** | `Contracts/Production/ProductionContracts.cs` |
| **Task helpers** | `Production/ProductionSupport.cs` |
| **Program.cs** | 5766 → **3314 lines** (−42%) |
| **Production TS types** | `domain/types/production.ts` |
| **Task utils (ready to wire)** | `features/production/lib/taskUtils.ts` |

**Build:** `dotnet build` ✅, `docker compose build` ✅

### Backup

- Tag: `pre-architecture-refactor-2026-06-23`
- Branch: `backup/pre-architecture-refactor-2026-06-23`
- Rollback: see `BACKUP_ROLLBACK.md`

---

## 3. What was moved

```
server/
├── Configuration/          NEW — Jwt, Database, Https, Admin options
├── Contracts/Auth/         NEW — LoginRequest, AuthResponse, CreateInitialAdminRequest
├── Endpoints/              NEW — AuthEndpoints.cs
├── Extensions/             NEW — DI + pipeline
└── Program.cs              SLIMMED (still contains ~84 endpoints + DTOs)

client/src/
├── shared/api/client.ts    NEW
└── shared/utils/formatters.ts NEW
```

---

## 4. What remains unchanged

- All API routes, DTO JSON shapes, DB schema, migrations
- Business logic in handlers (only relocated auth handlers verbatim)
- `OzonApiClient.cs` (2,552 lines), `IntegrationRoutes`, `KzMarketplaceRoutes`
- UI behavior and layout
- Docker runtime behavior

---

## 5. Issues discovered

| Issue | Severity | Notes |
|-------|----------|-------|
| Monolithic `Program.cs` | High | Main maintainability risk |
| Monolithic `App.tsx` + `App.css` | High | ~23k lines in 2 files |
| Adminer link on production | Medium | Requires SSH tunnel; documented in UI |
| No refresh tokens | Low | Session = JWT until expiry |
| `Console.WriteLine` | Low | Minimal use; prefer `ILogger` in new code |
| Duplicate Docker project on dev machine (fulvero vs lshop ports) | Ops | Use correct ports (8082 vs 18082) |

---

## 6. Recommended next phases

### Backend (priority order)

1. Extract **ProductionEndpoints** (26 routes) + move helpers to `Production/`
2. Extract **AdminEndpoints** (19 routes)
3. Extract **ChatEndpoints** (13), **SuppliesEndpoints** (12)
4. Move DTO records from `Program.cs` bottom → `Contracts/Request`, `Contracts/Response`
5. Introduce thin **Services** where handlers only orchestrate (same SQL/behavior)
6. Replace remaining `configuration["..."]` with `IOptions<T>`

### Frontend (priority order)

1. `domain/types/` — all TypeScript types from App.tsx
2. `shared/api/*.api.ts` — authApi, productionApi, chatApi, …
3. `features/users/` — `UsersAdminPanel` (already isolated)
4. `features/home/`, `features/production/` — largest JSX blocks
5. `app/App.tsx` — shell only (Providers, Router, Layout)
6. Split `App.css` → `features/*/*.css` + `shared/styles/`

### Docker

```
docker/
├── production/docker-compose.yml   (move from root)
├── development/docker-compose.yml
├── nginx/
├── postgres/
└── backup/postgres-backup.sh
```

---

## 7. Architecture diff

### Before

```
client/src/App.tsx (15.5k) ── all UI + state + API
client/src/App.css (7.3k)
server/Program.cs (6k) ── DI + middleware + 89 endpoints + DTOs
server/Ozon/, Integrations/, Security/ ...
```

### After (Phase 1)

```
client/src/
├── App.tsx (slightly smaller, uses shared/)
├── shared/api/client.ts
├── shared/utils/formatters.ts
└── shopRegion.ts, KzRegionUi.tsx

server/
├── Program.cs (~5.9k — pipeline/DI extracted, auth extracted)
├── Configuration/
├── Contracts/Auth/
├── Endpoints/AuthEndpoints.cs
├── Extensions/
└── (existing domain folders unchanged)
```

### Target (full refactor)

```
client/src/
├── app/          App.tsx, config, providers
├── features/     home, production, chat, …
├── shared/       api, components, utils, styles
└── domain/       types

server/
├── Program.cs    (~50 lines)
├── Endpoints/    Auth, Admin, Production, Chat, …
├── Services/     UserService, ProductionService, …
├── Contracts/    Request/, Response/
├── Configuration/
└── (Ozon, Telegram, SignalR isolated)
```

---

## 8. New structure (current)

See sections 3 and 7 above. Full target tree documented in refactor task spec.

---

**Rule applied:** No business logic changes. All extractions are copy-move with identical behavior.  
**Verify after each phase:** `dotnet build`, `npm run build`, `docker compose build`.
