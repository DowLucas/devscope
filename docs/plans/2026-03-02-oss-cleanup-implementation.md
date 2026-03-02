# Open Source Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the public repo clean and consistent for open source contributors — fix license refs, remove junk files, expand .gitignore, add package metadata, add SECURITY.md.

**Architecture:** All changes are to repo root and package config files. No application code changes. Incremental commits on `main`.

**Tech Stack:** Git, JSON, Markdown

---

### Task 1: Delete accidental empty files

**Files:**
- Delete: `AppContent` (repo root, 0 bytes)
- Delete: `AuthGuard` (repo root, 0 bytes)
- Delete: `config` (repo root, 0 bytes)
- Delete: `defaultnif` (repo root, 0 bytes)
- Delete: `packages/backend/agentId` (0 bytes)
- Delete: `packages/backend/field` (0 bytes)

**Step 1: Verify all files are 0 bytes before deleting**

```bash
wc -c AppContent AuthGuard config defaultnif packages/backend/agentId packages/backend/field
```

Expected: All show `0` bytes. If any file is NOT 0 bytes, skip it and flag for review.

**Step 2: Delete the files**

```bash
rm AppContent AuthGuard config defaultnif packages/backend/agentId packages/backend/field
```

**Step 3: Commit**

```bash
git add AppContent AuthGuard config defaultnif packages/backend/agentId packages/backend/field
git commit -m "chore: delete accidental empty files"
```

Note: `git add` on deleted files stages the deletion. These are untracked so this step may need `git clean` instead — check `git status` first. If untracked, just `rm` is sufficient (no commit needed for untracked files).

---

### Task 2: Fix license references

**Files:**
- Modify: `README.md:3` (badge text)
- Modify: `CONTRIBUTING.md:106` (license name)

**Step 1: Fix README badge**

In `README.md` line 3, replace:
```
[![License: PolyForm Noncommercial](https://img.shields.io/badge/License-PolyForm%20Noncommercial-purple.svg)](LICENSE)
```
With:
```
[![License: PolyForm Shield](https://img.shields.io/badge/License-PolyForm%20Shield-purple.svg)](LICENSE)
```

**Step 2: Fix CONTRIBUTING.md license reference**

In `CONTRIBUTING.md` line 106, replace:
```
By contributing, you agree that your contributions will be licensed under the PolyForm Noncommercial 1.0.0 License.
```
With:
```
By contributing, you agree that your contributions will be licensed under the project's existing licenses — see [LICENSE](LICENSE) for details.
```

(Point to the LICENSE file rather than naming a specific license, since the project is dual-licensed Shield + MIT.)

**Step 3: Commit**

```bash
git add README.md CONTRIBUTING.md
git commit -m "docs: fix license references from Noncommercial to Shield"
```

---

### Task 3: Expand .gitignore

**Files:**
- Modify: `.gitignore`

**Step 1: Add IDE, editor, and OS patterns**

Current `.gitignore`:
```
node_modules/
dist/
*.db
.DS_Store
.env
.env.*
!.env.production.example
```

Replace full file with:
```
node_modules/
dist/
*.db
.DS_Store
Thumbs.db

# Environment
.env
.env.*
!.env.production.example

# IDE / Editors
.vscode/
.idea/
*.swp
*.swo
*~
```

**Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: expand .gitignore with IDE and editor patterns"
```

---

### Task 4: Add package.json metadata

**Files:**
- Modify: `package.json` (root)
- Modify: `packages/backend/package.json`
- Modify: `packages/dashboard/package.json`
- Modify: `packages/shared/package.json`

**Step 1: Update root package.json**

Add `description`, `repository`, `license`, `author`, and `keywords` fields:

```json
{
  "name": "devscope",
  "description": "Real-time monitoring dashboard for Claude Code developer sessions",
  "private": true,
  "license": "SEE LICENSE IN LICENSE",
  "repository": {
    "type": "git",
    "url": "https://github.com/DowLucas/devscope.git"
  },
  "keywords": ["claude-code", "monitoring", "dashboard", "developer-tools"],
  "workspaces": ["packages/*"],
  "scripts": {
    "dev:backend": "bun run --hot packages/backend/src/index.ts",
    "dev:dashboard": "bun run --filter dashboard dev",
    "dev": "bun run scripts/dev.ts"
  }
}
```

**Step 2: Update packages/backend/package.json**

Add `description`, `repository`, `license` after the existing `version` field:

```json
"description": "Hono/Bun REST API and WebSocket server for DevScope",
"license": "PolyForm-Shield-1.0.0",
"repository": {
  "type": "git",
  "url": "https://github.com/DowLucas/devscope.git",
  "directory": "packages/backend"
},
```

**Step 3: Update packages/dashboard/package.json**

Rename from `"dashboard"` to `"@devscope/dashboard"`. Add metadata after `version`:

```json
"name": "@devscope/dashboard",
"description": "React monitoring dashboard for DevScope",
"license": "PolyForm-Shield-1.0.0",
"repository": {
  "type": "git",
  "url": "https://github.com/DowLucas/devscope.git",
  "directory": "packages/dashboard"
},
```

Note: Renaming requires updating the root `dev:dashboard` script filter from `dashboard` to `@devscope/dashboard`. Check `package.json` root script: `"dev:dashboard": "bun run --filter dashboard dev"` → `"dev:dashboard": "bun run --filter @devscope/dashboard dev"`.

**Step 4: Update packages/shared/package.json**

Add `description`, `repository`, `license` after `version`:

```json
"description": "Shared TypeScript types for DevScope",
"license": "MIT",
"repository": {
  "type": "git",
  "url": "https://github.com/DowLucas/devscope.git",
  "directory": "packages/shared"
},
```

**Step 5: Verify dev still works**

```bash
bun install
bun run dev:backend &
# Wait 2s, then kill
```

If the dashboard filter name change breaks anything, revert the name change and keep it as `dashboard`.

**Step 6: Commit**

```bash
git add package.json packages/backend/package.json packages/dashboard/package.json packages/shared/package.json
git commit -m "chore: add repository, license, and description to package.json files"
```

---

### Task 5: Add SECURITY.md

**Files:**
- Create: `SECURITY.md`

**Step 1: Create SECURITY.md**

```markdown
# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in DevScope, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, please use [GitHub Security Advisories](https://github.com/DowLucas/devscope/security/advisories/new) to privately report the vulnerability.

You should receive an acknowledgment within 48 hours. We will work with you to understand the issue and coordinate a fix before any public disclosure.

## Scope

This policy applies to:
- The DevScope backend API (`packages/backend/`)
- The DevScope dashboard (`packages/dashboard/`)
- The Claude Code plugin (`packages/plugin/`)

## Supported Versions

Only the latest version on the `main` branch is actively supported with security updates.
```

**Step 2: Commit**

```bash
git add SECURITY.md
git commit -m "docs: add SECURITY.md for vulnerability disclosure"
```
