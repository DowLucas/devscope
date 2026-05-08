import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { CURRENT_SALT_VERSION, deriveOrgSalt } from "../orgSalt";

// DEV-76: salt distribution invariants.
//
// Each test sets PRIVACY_SALT_KEY explicitly to keep the suite hermetic — the
// fallback to BETTER_AUTH_SECRET (or the dev constant) is intentionally not
// exercised here so a missing env in CI does not flake the assertions.

describe("orgSalt", () => {
  let originalSaltKey: string | undefined;

  beforeEach(() => {
    originalSaltKey = process.env.PRIVACY_SALT_KEY;
    process.env.PRIVACY_SALT_KEY = "test-privacy-salt-key";
  });

  afterEach(() => {
    if (originalSaltKey === undefined) delete process.env.PRIVACY_SALT_KEY;
    else process.env.PRIVACY_SALT_KEY = originalSaltKey;
  });

  test("CURRENT_SALT_VERSION starts at 1", () => {
    expect(CURRENT_SALT_VERSION).toBe(1);
  });

  test("returns a 32-char hex string", () => {
    const salt = deriveOrgSalt("org-abc");
    expect(salt).toMatch(/^[0-9a-f]{32}$/);
  });

  test("is deterministic for the same org id", () => {
    const a = deriveOrgSalt("org-abc");
    const b = deriveOrgSalt("org-abc");
    expect(a).toBe(b);
  });

  test("different orgs produce different salts", () => {
    const a = deriveOrgSalt("org-abc");
    const b = deriveOrgSalt("org-xyz");
    expect(a).not.toBe(b);
  });

  test("rotating the server secret changes the salt for the same org", () => {
    const before = deriveOrgSalt("org-abc");
    process.env.PRIVACY_SALT_KEY = "rotated-key";
    const after = deriveOrgSalt("org-abc");
    expect(after).not.toBe(before);
  });
});
