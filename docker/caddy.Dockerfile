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
# Stage 3: Serve with Caddy
# ==========================================================
FROM caddy:2-alpine AS production

COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/packages/dashboard/dist /srv/dashboard

RUN addgroup -S caddy && adduser -S caddy -G caddy && \
    chown -R caddy:caddy /srv /etc/caddy /data /config
USER caddy

EXPOSE 80 443

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:80/ || exit 1
