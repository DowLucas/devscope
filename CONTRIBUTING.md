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

### Testing locally

```bash
# Run Claude Code with the local plugin (no marketplace install needed)
claude --plugin-dir packages/plugin
```

### Publishing changes

Claude Code caches plugins by version, so **you must bump the version** for users to receive updates:

1. Bump `version` in the standalone repo's `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`
2. Keep `packages/plugin/.claude-plugin/plugin.json` in sync
3. Push to `main` on `DowLucas/devscope-plugin`
4. Users run `claude plugin update devscope` and restart Claude Code

### Plugin structure

```
.claude-plugin/
  plugin.json          # Plugin manifest (name, version)
  marketplace.json     # Makes the repo a marketplace source
hooks/
  hooks.json           # Hook event → script mappings (uses ${CLAUDE_PLUGIN_ROOT})
commands/
  setup.md             # /devscope:setup slash command
scripts/
  _helpers.sh          # Cross-platform helpers
  send-event.sh        # Core event sender
  *.sh                 # Individual hook scripts
```

See the [devscope-plugin CLAUDE.md](https://github.com/DowLucas/devscope-plugin/blob/main/CLAUDE.md) for full plugin architecture details.

## Reporting Issues

Use [GitHub Issues](https://github.com/DowLucas/devscope/issues) with the provided templates.

## License

By contributing, you agree that your contributions will be licensed under the project's existing licenses — see [LICENSE](LICENSE) for details.
