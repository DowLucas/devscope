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

The worker (Task 5.2) will spawn this image with:

```
docker run --rm -i \
  --read-only \
  --tmpfs /work \
  --user 1000:1000 \
  --cap-drop=ALL \
  --memory=2g \
  --pids-limit=256 \
  --network devscope-egress-allowlist \
  devscope/worker-sandbox:<sha>
```

- `--read-only` — image filesystem is immutable; only `/work` (tmpfs) and `/tmp`
  are writable.
- `--tmpfs /work` — workspace lives in RAM, evaporates on container exit.
- `--user 1000:1000` — matches the `sandbox` user baked into the image.
- `--cap-drop=ALL` — no Linux capabilities.
- `--memory=2g`, `--pids-limit=256` — resource caps.
- `--network devscope-egress-allowlist` — bespoke network whose egress is
  filtered to api.github.com / github.com / api.anthropic.com (configured by
  the host, not this image).

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
