# ==========================================================
# DevScope worker sandbox image.
# Per-task ephemeral container spawned by the suggestion-worker
# (Epic 5). One short-lived process per container — no init,
# no tini, no cron. Single-shot: read candidate JSON on stdin,
# emit artifact JSON on stdout, exit.
# ==========================================================
# Bun version pinned explicitly. Bump deliberately when the
# rest of the monorepo upgrades.
FROM oven/bun:1.1.45-alpine

# Install runtime deps:
#   git              — clone target repo
#   ca-certificates  — TLS for github.com
#   jq               — entrypoint.sh JSON validation
#   bash             — entrypoint script (alpine ships ash by default)
RUN apk add --no-cache \
        git \
        ca-certificates \
        jq \
        bash \
    && rm -rf /var/cache/apk/*

# Non-root user. UID/GID 1000 matches what Task 5.2 will pass via
# --user 1000:1000 at `docker run` time. The base image already ships
# a `bun` user/group at 1000:1000; remove it first so we own the names
# (and so any future base-image renames don't surprise us).
RUN deluser --remove-home bun 2>/dev/null || true \
    && delgroup bun 2>/dev/null || true \
    && addgroup -g 1000 sandbox \
    && adduser -D -u 1000 -G sandbox -s /bin/bash sandbox

# Copy agent + verify scripts. Owned by the sandbox user, mode 0555
# (read+execute, no write — image is read-only at runtime anyway).
COPY --chown=1000:1000 --chmod=0555 entrypoint.sh /app/entrypoint.sh
COPY --chown=1000:1000 --chmod=0555 agent/ /app/agent/
COPY --chown=1000:1000 --chmod=0555 verify/ /app/verify/

# /work is the writable workspace. Task 5.2 will tmpfs-mount this
# at runtime; we create it here so the path exists in the image.
RUN mkdir -p /work && chown 1000:1000 /work
WORKDIR /work

USER 1000:1000

ENTRYPOINT ["/app/entrypoint.sh"]
