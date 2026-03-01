# Rename: groundcontrol → DevScope

**Date**: 2026-02-28
**Domain**: devscope.sh (confirmed available)

## Decision

Rename the project from "groundcontrol" to "DevScope".

| Context | Format | Example |
|---|---|---|
| UI / docs / branding | DevScope | "DevScope Dashboard" |
| Package names | `@devscope/shared` | `@devscope/backend` |
| Directory / repo | devscope | `github.com/.../devscope` |
| TypeScript types | `DevscopeEvent` | `export interface DevscopeEvent` |
| Hook function | `useDevscopeSocket` | replaces `useGroundcontrolSocket` |
| DB filename | `devscope.db` | replaces `groundcontrol.db` |
| Log prefix | `[devscope]` | replaces `[groundcontrol]` |
| Env var prefix | `GC_` → keep as-is | `GC_API_KEY`, `GC_CORS_ORIGIN` stay |
| Docker volume | `gc-data` → keep as-is | abbreviation still works |

## Rename Inventory

### High priority (breaking)

1. **Type `GroundcontrolEvent`** → `DevscopeEvent` — used in shared, backend, dashboard (~15 files)
2. **Package names** in all `package.json` files:
   - Root: `groundcontrol` → `devscope`
   - `@groundcontrol/shared` → `@devscope/shared`
   - `@groundcontrol/backend` → `@devscope/backend`
3. **Import paths** — every `from "@groundcontrol/shared"` → `from "@devscope/shared"`
4. **Hook function** `useGroundcontrolSocket()` → `useDevscopeSocket()` in `useWebSocket.ts` + `App.tsx`
5. **Plugin name** in `plugin.json`: `"name": "groundcontrol"` → `"name": "devscope"`
6. **DB default** in `schema.ts`: `"groundcontrol.db"` → `"devscope.db"`

### Medium priority (config/UI)

7. **HTML title** in `index.html`: `<title>Groundcontrol</title>` → `<title>DevScope</title>`
8. **UI heading** in `Layout.tsx`: `Groundcontrol` → `DevScope`
9. **Docker env** `DB_PATH` values in compose files and Dockerfile: `groundcontrol.db` → `devscope.db`
10. **CLAUDE.md** — update project name, description, type references

### Low priority (logs/docs)

11. **Console logs** in `backend/src/index.ts`: `[groundcontrol]` → `[devscope]` (7 occurrences)
12. **Design docs** in `docs/plans/` — old docs can keep their names, they're historical

### Keep as-is

- `GC_API_KEY`, `GC_CORS_ORIGIN` env vars — already abbreviated, not worth breaking existing configs
- `gc-data` Docker volume — already abbreviated
- Git history — no rewrite
- Directory structure (`packages/backend`, etc.) — no "groundcontrol" in paths

## Affected Files (~30 files)

**Config**: root `package.json`, `packages/*/package.json`, `bun.lock` (auto-regenerated), `plugin.json`
**Shared**: `events.ts`, `index.ts`
**Backend**: `schema.ts`, `queries.ts`, `index.ts`, `routes/events.ts`, `ws/handler.ts`
**Dashboard**: `index.html`, `App.tsx`, `useWebSocket.ts`, `Layout.tsx`, `EventCard.tsx`, `LiveFeed.tsx`, + ~15 component files with `@groundcontrol/shared` imports
**Docker**: `docker-compose.yml`, `docker-compose.override.yml`, `docker/backend.Dockerfile`
**Docs**: `CLAUDE.md`

## Migration Notes

- After rename, run `bun install` to regenerate `bun.lock`
- Existing SQLite databases named `groundcontrol.db` won't auto-migrate — rename manually or set `DB_PATH`
- GitHub repo rename is a separate manual step
