# Postgres + pgvector, kept on Alpine on purpose.
#
# Production's data directory was initialised by postgres:17-alpine with
# en_US.utf8 collation under musl. The official pgvector/pgvector images are
# Debian (glibc), which sorts text differently and would silently invalidate
# every existing text btree index. Building pgvector onto the same Alpine base
# keeps the libc (and therefore the collation) identical: no upgrade, no
# reindex, just an extra extension on disk.
FROM postgres:17.9-alpine

ARG PGVECTOR_VERSION=v0.8.6

# OPTFLAGS="" avoids -march=native, so the image runs on any x86_64 host, not
# just the CI runner that built it. with_llvm=no skips JIT bitcode, which would
# otherwise need a clang matching the server's LLVM build.
RUN apk add --no-cache --virtual .build-deps git build-base \
    && git clone --branch "$PGVECTOR_VERSION" --depth 1 https://github.com/pgvector/pgvector.git /tmp/pgvector \
    && make -C /tmp/pgvector OPTFLAGS="" with_llvm=no \
    && make -C /tmp/pgvector install with_llvm=no \
    && rm -rf /tmp/pgvector \
    && apk del .build-deps
