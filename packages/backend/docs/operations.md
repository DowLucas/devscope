# Backend operations runbook

## Consent revoke — delete an organization's data

When a pilot revokes consent and asks for their data to be removed, run the
operator script below from the backend package. It performs every required
DELETE inside a single transaction and post-checks for residual rows.

```bash
# 1. Confirm what will be removed (transaction is rolled back).
DATABASE_URL=postgres://... \
  bun run packages/backend/scripts/delete-org.ts <organizationId> --dry-run

# 2. Execute the deletion.
DATABASE_URL=postgres://... \
  bun run packages/backend/scripts/delete-org.ts <organizationId> --yes

# 3. Verify zero residual rows (separate read-only check).
DATABASE_URL=postgres://... \
  bun run packages/backend/scripts/delete-org.ts <organizationId> --verify
```

Expected duration: under 30 seconds for a typical pilot org (a few thousand
events). The script reports `committed` plus per-table delete counts on
success, and exits non-zero with `RESIDUAL ROWS DETECTED` if anything
survived. The script does NOT touch `auth_user` accounts or API keys (those
are user-scoped, not org-scoped); a user requesting full account deletion
must additionally hit `DELETE /api/account`.

See `packages/backend/scripts/delete-org.ts` for the table-by-table audit
that drives the deletion order.
