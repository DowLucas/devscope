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

4. **Install the plugin locally** (for testing):
   ```bash
   claude --plugin-dir packages/plugin
   ```

## Project Structure

```
packages/
  shared/      TypeScript types (the contract between packages)
  backend/     Hono REST API + WebSocket (Bun)
  dashboard/   React 19 + Vite + TailwindCSS 4
  plugin/      Bash hooks for Claude Code
```

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

The plugin at `packages/plugin/` is a local development copy. The installable standalone version lives at [github.com/DowLucas/devscope-plugin](https://github.com/DowLucas/devscope-plugin). If you're making plugin changes, update both locations.

## Reporting Issues

Use [GitHub Issues](https://github.com/DowLucas/devscope/issues) with the provided templates.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
