import { createHmac } from "node:crypto";

/**
 * DEV-76: Per-organization salt distribution for plugin-side path hashing.
 *
 * The plugin (DEV-74) hashes file_path/pattern/path values before they hit
 * the wire. To keep the same path stable across all sessions in an org —
 * but unrelatable across orgs — the backend hands out a deterministic
 * per-org salt, keyed by a server-side secret, on session.start.
 *
 * Invariants:
 *   - Salt is HMAC_SHA256(serverSecret, organizationId), hex-truncated to 32 chars.
 *     Deterministic per (server-secret, org), stable across backend restarts.
 *   - Salt is NEVER persisted (no events.payload, no log lines, no audit row).
 *     Only `salt_version` is persisted per session.
 *   - Server secret is read from PRIVACY_SALT_KEY first, falling back to
 *     BETTER_AUTH_SECRET (already required-non-default in production by
 *     packages/backend/src/index.ts).
 *
 * Salt rotation (incrementing CURRENT_SALT_VERSION) is intentionally out of
 * scope here — DEV-43 will own that.
 */

export const CURRENT_SALT_VERSION = 1;

const SALT_HEX_LENGTH = 32;

let warnedMissingDedicatedKey = false;

function getServerSecret(): string {
  const dedicated = process.env.PRIVACY_SALT_KEY;
  if (dedicated && dedicated.length > 0) return dedicated;

  const auth = process.env.BETTER_AUTH_SECRET;
  if (auth && auth.length > 0) {
    if (!warnedMissingDedicatedKey) {
      console.warn(
        "[orgSalt] PRIVACY_SALT_KEY is not set; falling back to BETTER_AUTH_SECRET. " +
        "Set a dedicated PRIVACY_SALT_KEY before salt rotation work (DEV-43)."
      );
      warnedMissingDedicatedKey = true;
    }
    return auth;
  }

  // Dev fallback so local stacks without either env still boot. Production
  // refuses to start with a default BETTER_AUTH_SECRET (see index.ts), so
  // this branch is only reachable in dev/test.
  return "devscope-dev-privacy-salt";
}

/**
 * Derive the per-org salt that the plugin should use for value hashing.
 *
 * Returns 32 hex chars (128 bits, sufficient for non-reverse-mappable hashes
 * given the input space and HMAC keying). Result is the salt itself; do not
 * log, persist, or audit-log this value.
 */
export function deriveOrgSalt(organizationId: string): string {
  const secret = getServerSecret();
  return createHmac("sha256", secret)
    .update(organizationId)
    .digest("hex")
    .slice(0, SALT_HEX_LENGTH);
}
