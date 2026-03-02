# Open Source Cleanup Design

**Date**: 2026-03-02
**Approach**: Incremental fix on `main` (Approach A)

## Problem

The repo is public but has license inconsistencies, junk files, incomplete .gitignore, and missing package metadata.

## Scope

### 1. Delete accidental empty files

These 0-byte files at repo root and `packages/backend/` are accidental (terminal typos/failed redirects), not referenced by any code:

- `AppContent` (root)
- `AuthGuard` (root)
- `config` (root)
- `defaultnif` (root)
- `packages/backend/agentId`
- `packages/backend/field`

### 2. Fix license references

The actual LICENSE is **PolyForm Shield 1.0.0** but two files reference it incorrectly:

- `README.md` line 3: badge says "PolyForm Noncommercial" → change to "PolyForm Shield"
- `CONTRIBUTING.md` line 106: says "PolyForm Noncommercial 1.0.0" → change to "PolyForm Shield 1.0.0"

### 3. Expand .gitignore

Add missing patterns:
- IDE: `.vscode/`, `.idea/`
- Editor swap: `*.swp`, `*.swo`, `*~`
- OS: `Thumbs.db`

### 4. Add package.json metadata

Add `repository`, `license`, `description` fields to:
- Root `package.json`
- `packages/backend/package.json`
- `packages/dashboard/package.json`
- `packages/shared/package.json`

### 5. Add SECURITY.md

Standard vulnerability disclosure policy pointing to GitHub Security Advisories or an email.

## Out of Scope

- Committing the 65+ modified / 40+ untracked files (separate task)
- README content improvements beyond the license badge
- History rewriting
