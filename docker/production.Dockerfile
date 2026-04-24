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
# Stage 2: Build the dashboard
# ==========================================================
FROM oven/bun:1 AS build

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/dashboard/node_modules ./packages/dashboard/node_modules

COPY package.json tsconfig.base.json ./
COPY packages/shared/ ./packages/shared/
COPY packages/dashboard/ ./packages/dashboard/

WORKDIR /app/packages/dashboard
RUN bun run build

# ==========================================================
# Stage 3: Production image (backend + static dashboard)
# ==========================================================
FROM oven/bun:1-slim AS production

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/backend/node_modules ./packages/backend/node_modules

COPY package.json tsconfig.base.json ./
COPY packages/shared/ ./packages/shared/
COPY packages/backend/ ./packages/backend/

# Copy dashboard build into backend's dist/ (served by Hono serveStatic)
COPY --from=build /app/packages/dashboard/dist ./packages/backend/dist

ENV PORT=6767
ENV SERVE_STATIC=true

EXPOSE 6767

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://localhost:6767/api/health').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"

CMD ["bun", "run", "packages/backend/src/index.ts"]
