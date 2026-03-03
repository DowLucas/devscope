# Contributing to DevScope

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

1. **Prerequisites**: [Bun](https://bun.sh/) (v1.0+), Docker (optional, for PostgreSQL)

2. **Clone and install**:
   ```bash
   git clone https://github.com/DowLucas/devscope.git
   cd devscope
   bun install
   ```

3. **Start the dev environment**:
   ```bash
   # With Docker (includes PostgreSQL)
   docker compose up --build

   # Without Docker (requires local PostgreSQL)
   export DATABASE_URL="postgres://user:pass@localhost:5432/devscope"
   bun run dev
   ```

## Project Structure

```
packages/
  shared/      TypeScript types (the contract between packages)
  backend/     Hono REST API + WebSocket (Bun)
  dashboard/   React 19 + Vite + TailwindCSS 4
```

The plugin (Bash hooks) lives in a separate repo: [DowLucas/devscope-plugin](https://github.com/DowLucas/devscope-plugin)

## Making Changes

1. Create a feature branch from `main`
2. Make your changes
3. Run tests: `cd packages/backend && bun test`
4. Run lint: `cd packages/dashboard && bun run lint`
5. Submit a PR

## Code Style

- TypeScript for backend and dashboard
- Bash (POSIX-compatible) for plugin scripts
- Follow existing patterns in the codebase
- See `CLAUDE.md` for architecture details and conventions

## Pull Requests

- Keep PRs focused on a single change
- Include a description of what and why
- Link related issues

## Plugin Development

The plugin lives in a separate repo: [DowLucas/devscope-plugin](https://github.com/DowLucas/devscope-plugin). See that repo's CLAUDE.md for plugin development details.

To test locally: `claude --plugin-dir /path/to/devscope-plugin`

## Reporting Issues

Use [GitHub Issues](https://github.com/DowLucas/devscope/issues) with the provided templates.

## License

By contributing, you agree that your contributions will be licensed under the project's existing licenses — see [LICENSE](LICENSE) for details.
