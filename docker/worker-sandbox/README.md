# DevScope worker sandbox image

Per-task ephemeral container spawned by the suggestion-worker (Epic 5) for each
candidate. The container reads one candidate JSON object on STDIN, shallow-clones
the target repository, runs the Claude agent driver to produce a draft patch,
runs the verifier to evaluate the six binary gates, and emits a single artifact
JSON object on STDOUT before exiting. One short-lived process per container — no
init, no cron, no long-running daemons.

## Build locally

```bash
cd docker/worker-sandbox
docker build -t devscope/worker-sandbox:local .
```

## Invoke for testing

```bash
cat sample-candidate.json | docker run --rm -i devscope/worker-sandbox:local
```

The sample candidate clones `octocat/Hello-World` (no token required) and runs
the stubbed agent + skeleton verifier. Expected output is a single
`{"status":"completed", ...}` JSON object. On any failure (missing field,
clone error, agent crash, verifier crash) the container instead writes
`{"status":"failed","reason":"..."}` to stdout and exits 0 — the host is
expected to read structured failure rather than infer from exit codes.

## Runtime constraints (applied by the worker, Task 5.2)

The worker (Task 5.2) MUST spawn this image with the exact flags below.
This is the runtime contract — change it only by updating this README
and the egress-proxy filter together.

```
docker run --rm -i \
  --network devscope-cloud_devscope-egress-allowlist \
  --read-only \
  --tmpfs /work:rw,size=512m,uid=1000 \
  --tmpfs /tmp:rw,size=64m,uid=1000 \
  --user 1000:1000 \
  --cap-drop=ALL \
  --memory=2g \
  --pids-limit=256 \
  --env HTTPS_PROXY=http://egress-proxy:8888 \
  --env HTTP_PROXY=http://egress-proxy:8888 \
  --env NO_PROXY=localhost,127.0.0.1 \
  devscope/worker-sandbox:<sha>
```

- `--read-only` — image filesystem is immutable; only the explicitly
  declared tmpfs mounts are writable.
- `--tmpfs /work:rw,size=512m,uid=1000` — workspace lives in RAM,
  evaporates on container exit, owned by the sandbox user.
- `--tmpfs /tmp:rw,size=64m,uid=1000` — git, npm, etc. need a writable
  `/tmp`; small ephemeral mount keeps it bounded.
- `--user 1000:1000` — matches the `sandbox` user baked into the image.
- `--cap-drop=ALL` — no Linux capabilities.
- `--memory=2g`, `--pids-limit=256` — resource caps.
- `--network devscope-cloud_devscope-egress-allowlist` — internal docker
  network (`internal: true`) with no host route. The `egress-proxy`
  service (Task 3.2, `docker/egress-proxy/`) is the only other member
  and bridges to the default network; it filters destinations to:
  - `api.anthropic.com`
  - `api.github.com`
  - `github.com`
  - `*.githubusercontent.com`
- `HTTPS_PROXY` / `HTTP_PROXY` — `git`, `curl`, and the Anthropic SDK
  honour these. The compose project name (`devscope-cloud`) prefixes
  the network and `egress-proxy` resolves via the embedded docker
  resolver. Verified: `git clone https://github.com/...` works through
  the proxy via libcurl's HTTPS_PROXY support — no entrypoint changes
  required.

### Smoke checks (Task 3.2 verification)

With `egress-proxy` running (`docker compose up -d egress-proxy`), the
following all hold:

| Check | Expected | Actual |
|---|---|---|
| `curl https://api.github.com/zen` (with proxy env) | 200 + zen text | pass |
| `curl https://example.com` (with proxy env) | 403 from proxy | pass |
| `git clone --depth 1 https://github.com/octocat/Hello-World.git /work/repo` | succeeds | pass |
| `curl --max-time 4 http://1.1.1.1` (no proxy) | connect refused (no NAT) | pass |

## Stub status

Two files in this image are **stubs/skeletons** that later tasks will replace:

- `agent/runAgent.ts` — STUB. Returns a hardcoded empty draft. Task 5.3 will
  implement the real Claude tool-use loop.
- `verify/verifyPatch.ts` — SKELETON. Implements `patch_applies` and
  `kind_scope` (claude_md only) for real; the other four gates
  (`evidence_dereferences`, `tests`, `lint`, `conventions`) return
  `{pass:true, reason:'TODO Task 5.4'}`. Task 5.4 will fill them in.

The `VerificationResult` type in `verify/verifyPatch.ts` is a local mirror of
the canonical shape in `packages/shared/src/github.ts` — the sandbox is built
from a separate Docker context and intentionally cannot import from the
workspace. Keep the two definitions in sync.
