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
# Stage 3: Serve with Nginx
# ==========================================================
FROM nginx:1-alpine AS production

RUN rm /etc/nginx/conf.d/default.conf
COPY docker/nginx/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/packages/dashboard/dist /usr/share/nginx/html

# Fix permissions for unprivileged nginx: pid file, cache, and logs
RUN sed -i 's|/run/nginx.pid|/tmp/nginx.pid|' /etc/nginx/nginx.conf && \
    chown -R nginx:nginx /var/cache/nginx /var/log/nginx

EXPOSE 8080

USER nginx

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/ || exit 1
