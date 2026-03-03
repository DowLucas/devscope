## What

Brief description of the change.

## Why

What problem does this solve? Link to issue if applicable.

## How

Implementation approach (if not obvious from the diff).

## Checklist

- [ ] Tests pass (`cd packages/backend && bun test`)
- [ ] Lint passes (`cd packages/dashboard && bun run lint`)
- [ ] Types check (`cd packages/dashboard && bunx tsc --noEmit`)
- [ ] CI checks pass (all three jobs green)
- [ ] Docker builds work (`docker compose up --build`)
