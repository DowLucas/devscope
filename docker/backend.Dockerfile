# ==========================================================
# Stage 1: Install dependencies
# ==========================================================
FROM oven/bun:1 AS deps

WORKDIR /app

COPY package.json bun.lock tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/backend/package.json ./packages/backend/
COPY packages/dashboard/package.json ./packages/dashboard/

RUN bun install --frozen-lockfile

# ==========================================================
# Stage 2: Production image
# ==========================================================
FROM oven/bun:1-slim AS production

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/backend/node_modules ./packages/backend/node_modules

COPY package.json tsconfig.base.json ./
COPY packages/shared/ ./packages/shared/
COPY packages/backend/ ./packages/backend/

ENV PORT=6767
ENV DATABASE_URL=

EXPOSE 6767

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://localhost:6767/api/health').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"

RUN addgroup --system --gid 1001 devscope && \
    adduser --system --uid 1001 --ingroup devscope devscope
USER devscope

CMD ["bun", "run", "packages/backend/src/index.ts"]
