# ==========================================================
# Stage 1: Install dependencies (full workspace graph)
# ==========================================================
FROM oven/bun:1 AS deps

WORKDIR /app

COPY package.json bun.lock tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/backend/package.json ./packages/backend/
COPY packages/dashboard/package.json ./packages/dashboard/
COPY packages/worker/package.json ./packages/worker/

RUN bun install --frozen-lockfile

# ==========================================================
# Stage 2: Runtime
# ==========================================================
FROM oven/bun:1-slim AS runtime

WORKDIR /app

# Non-root user. Bun 1.3 lockfile parsing requires bun:1 (not 1.1.45 which
# matches the sandbox image — that mismatch is intentional and recorded here:
# the worker host runs the orchestrator, not the sandboxed task. UID 1001
# matches packages/backend/Dockerfile to keep volume permissions consistent.
RUN groupadd --system --gid 1001 worker && \
    useradd --system --uid 1001 --gid worker --no-create-home worker

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/worker/node_modules ./packages/worker/node_modules

COPY package.json tsconfig.base.json ./
COPY packages/shared/ ./packages/shared/
# Worker imports query modules directly from packages/backend/src/db/* via
# relative paths; we need the backend source (but not its node_modules) for
# those imports to resolve at runtime.
COPY packages/backend/src/db/ ./packages/backend/src/db/
COPY packages/backend/package.json ./packages/backend/
COPY packages/worker/ ./packages/worker/

ENV DATABASE_URL=
ENV SUGGESTION_WORKER_ENABLED=false

USER worker

# Liveness: process can boot the runtime. Worker exposes no HTTP surface.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD bun -e 'process.exit(0)'

ENTRYPOINT ["bun", "run", "packages/worker/src/index.ts"]
