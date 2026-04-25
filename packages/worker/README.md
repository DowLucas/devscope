# @devscope/worker

Suggestion-worker service. Polls `suggestion_candidates`, claims one at a time,
revalidates evidence freshness + suppression, runs the candidate through a
sandbox container, then writes the resulting `suggestion_artifacts` row.

## Status

Task 5.1 — **scaffold only**. The sandbox runner (`src/sandboxRunner.ts`) is a
stub that always returns a `failed` artifact citing "sandbox not implemented
(Task 5.2)". Task 5.2 fills in the real sandbox spawn.

## Run

```bash
DATABASE_URL=postgres://... SUGGESTION_WORKER_ENABLED=true bun run src/index.ts
```

When `SUGGESTION_WORKER_ENABLED` is unset or `false`, the loop sleeps and never
claims a candidate. This is the default, so the container can sit idle in the
compose stack until you flip the flag.

## Crash recovery

The worker never manually un-claims. `claim_expires_at` (10 minute lease set by
`claimNextCandidate`) is the recovery mechanism — a candidate left in
`in_progress` past its lease can be reclaimed by the next worker poll.

## Tests

```bash
bun test
```

Covers `revalidate.ts` and `persistArtifact.ts`. The main loop and sandbox
runner stub get real coverage in Tasks 5.2 / 5.3.
