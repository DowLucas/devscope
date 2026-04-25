# DevScope egress proxy

A minimal forward HTTP/HTTPS-CONNECT proxy (`tinyproxy` on Alpine) that
the sandbox containers (Task 3.1) talk to as their sole egress path.
Default-deny; only three hostname patterns are allowed:

- `api.anthropic.com` — Claude API
- `api.github.com` — GitHub REST API
- `github.com` — `git clone` (smart-HTTP transport hits the apex host)
- `*.githubusercontent.com` — raw content, codeload archives, LFS objects

The `github.com` apex was added beyond the original three-host plan
because the standard `git clone https://github.com/...` flow connects
to `github.com` itself for the smart-HTTP protocol; without it, clones
fail with `CONNECT tunnel failed, response 403`. The `*.githubusercontent.com`
wildcard alone is insufficient for git transport.

## Why this exists

The sandbox network (`devscope-egress-allowlist` in `docker-compose.yml`)
is declared `internal: true`, so containers attached to it have no route
to the host or the public internet. The egress proxy is the only
container also attached to the default bridge network, so all outbound
traffic must transit it. By configuring sandbox processes with
`HTTPS_PROXY=http://egress-proxy:8888`, every request is filtered
against the allowlist regex in [`filter`](./filter); anything else gets
a 403 from tinyproxy.

## Build

```bash
cd docker/egress-proxy
docker build -t devscope/egress-proxy:local .
```

## Run via compose

```bash
docker compose up -d egress-proxy
```

The compose service attaches to two networks:
- `devscope-egress-allowlist` (internal) — sandbox-facing.
- `default` (the project's bridge net) — for upstream HTTPS to the allowed hosts.

## Trade-off — why hostname filtering and not a real HTTPS-inspecting proxy

Tinyproxy's filter operates on the CONNECT request hostname (and HTTP
host header). It cannot inspect TLS-encrypted payloads, so SNI/Host
header spoofing combined with knowing the IP of an arbitrary service
is in principle bypassable. We accept this for v1 because:

1. The sandbox is driven by Claude tool-use over the same proxy, not
   arbitrary code chosen by the suggestion author.
2. The network is `internal: true`, so direct IP egress is impossible
   — every outbound packet must carry a CONNECT request the proxy
   approves.
3. Replacing tinyproxy with a TLS-terminating proxy (mitmproxy, Squid +
   SSL bump) is the documented v1.5 fallback if we observe abuse.

## Logging

`LogLevel Notice` writes connection-level events (open/close, allow/deny)
to stdout. Tinyproxy does not log request paths or headers at this
level — `FilterURLs No` and `LogLevel Notice` together ensure URL/query
strings are never persisted, since sandbox traffic may include tokens
or PII.
