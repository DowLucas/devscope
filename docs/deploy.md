# Deployment & rollback

This doc describes the production deploy pipeline, the staging gate that sits in
front of it, and how to roll back when a bad release reaches prod.

Operational specifics that must NOT live in this repo (host address, SSH config,
Watchtower bearer tokens, admin credentials) live in `DEPLOY.local.md` on the
operator's machine and on the prod host.

## Pipeline at a glance

```
push to main
   │
   ▼
.github/workflows/ci.yml
   ├─ test / lint / typecheck
   ├─ deploy:           build & push ghcr.io/dowlucas/devscope-backend:{latest, <sha>}
   └─ promote-staging:  force staging Watchtower update → poll /api/health for <sha>
                        → smoke → retag <sha> as :stable → push
   │
   ▼
Watchtower on staging host  → tracks :latest  → restarts on every push
Watchtower on prod host     → tracks :stable  → restarts only after smoke passes
```

A merge to `main` reaches prod only if the staging container reports the new
`commit` SHA on `/api/health` AND the smoke step exits 0. Any other outcome
leaves `:stable` (and therefore prod) on the previous good build.

## What gets baked into the image

The CI build passes `--build-arg COMMIT_SHA=$GITHUB_SHA`. The Dockerfile
exports it as `ENV COMMIT_SHA`, and the backend echoes it back from
`GET /api/health`:

```json
{ "status": "ok", "clients": 0, "commit": "<sha>", "started_at": "<iso>" }
```

The promote-staging job uses the `commit` field to confirm staging is running
the exact image just built before it promotes anything to `:stable`.

## Required GitHub Actions secrets

| Secret | Purpose | Required? |
|---|---|---|
| `STAGING_HEALTH_URL` | Public URL of staging `/api/health` (e.g. `https://staging-api.devscope.example/api/health`) | **yes** — gate fails closed if absent |
| `STAGING_WATCHTOWER_URL` | Staging Watchtower HTTP API endpoint (e.g. `https://staging-api.devscope.example/v1/update`) | optional — without it we wait for Watchtower's 5 min poll |
| `STAGING_WATCHTOWER_TOKEN` | Bearer token for that endpoint | required iff `STAGING_WATCHTOWER_URL` is set |

## Staging stack on the prod host (operator setup)

Staging runs as a **separate compose project** on the same Docker host as prod:

- compose project name: `devscope-staging`
- working dir: `/opt/devscope-staging/`
- backend bound to host loopback `127.0.0.1:6868` (prod uses `127.0.0.1:6767`)
- postgres bound to host loopback `127.0.0.1:5433` (prod uses `127.0.0.1:5432`)
- named postgres volume: `staging-pgdata` (prod uses `gc-pgdata`) — staging
  migrations CANNOT touch the prod DB
- Cloudflare tunnel hostname: `staging-api.<prod-domain>` → `127.0.0.1:6868`
- Watchtower instance label-scoped to `staging` watching `:latest`
- Prod Watchtower must be label-scoped to `production` and switched to `:stable`

A starter compose template lives at `docker/staging.compose.example.yml` and is
designed to be customised in `/opt/devscope-staging/` (the customised file is
NOT in the repo because it carries staging secrets).

## Rollback

All images are immutable by SHA on GHCR. To roll prod back to a known-good
build, pin the backend image to that SHA in the prod compose file and restart
the backend service. Watchtower respects pinned image tags and will leave them
alone until the pin is removed.

```bash
# On the prod host, in the prod compose directory:
GOOD_SHA=<sha-from-git-log-or-ghcr>
# Replace `:stable` with `:<sha>` in the prod compose file:
sed -i \
  "s|ghcr.io/dowlucas/devscope-backend:stable|ghcr.io/dowlucas/devscope-backend:${GOOD_SHA}|" \
  docker-compose.yml
docker compose up -d backend

# To resume normal :stable tracking later, revert the pin:
sed -i \
  "s|ghcr.io/dowlucas/devscope-backend:${GOOD_SHA}|ghcr.io/dowlucas/devscope-backend:stable|" \
  docker-compose.yml
docker compose up -d backend
```

Alternatives (in order of preference):

1. **Re-promote a known-good SHA from CI.** Re-run the `promote-staging` job
   on a previous green run from the GitHub Actions UI; it will retag the older
   SHA as `:stable` and prod Watchtower will pick it up within ~5 min.
2. **Local rollback (above) — the docker compose `sed` pin.** Use this if CI
   is unavailable or you need an immediate rollback.
3. **Fast revert.** Open a PR that reverts the bad commit, merge to main, let
   the gate run normally. Slowest but most auditable.

## Verifying the gate works

Per DEV-15 acceptance: a known-bad merge to `main` must NOT reach prod.

To verify after the gate is live:

1. Branch off `main`.
2. Edit `packages/backend/src/index.ts` to make `/api/health` return `500`.
3. Merge the branch to `main`.
4. Watch GitHub Actions:
   - `deploy` job succeeds (image is built and pushed).
   - `promote-staging` job either fails on the smoke step (status != ok) or
     never sees the new SHA → `:stable` is NOT updated.
5. Confirm prod is still serving the previous good `commit` via
   `curl https://<prod-host>/api/health`.
6. Revert the bad commit and merge.

## Health endpoint contract

`GET /api/health` returns 200 with:

```json
{
  "status": "ok",            // string, expected "ok"
  "clients": 0,              // non-negative integer (current WS client count)
  "commit": "<sha>",         // 40-char git SHA, or "unknown" for local builds
  "started_at": "<iso8601>"  // process boot time, refreshed on every restart
}
```

Smoke and external monitors should treat the endpoint as `200 OK + status==="ok"`.
The `commit` and `started_at` fields are advisory for ops; they exist so we can
distinguish "Watchtower hasn't pulled yet" from "the new build is up but
broken".
