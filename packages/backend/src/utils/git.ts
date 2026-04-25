/**
 * Parse a git remote URL into a normalized `{owner, repo}` pair.
 *
 * Accepts both GitHub forms:
 *   - https://github.com/owner/repo(.git)
 *   - git@github.com:owner/repo(.git)
 *
 * Returns null for non-GitHub remotes or malformed input. The `.git` suffix
 * (if present) is stripped so the result matches `repo_installations.repo`.
 */
export function normalizeRepoFromGitRemote(
  remote: string | null | undefined
): { owner: string; repo: string } | null {
  if (!remote || typeof remote !== "string") return null;
  const trimmed = remote.trim();
  if (!trimmed) return null;

  // SSH form: git@github.com:owner/repo(.git)
  const sshMatch = trimmed.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i);
  if (sshMatch) {
    return { owner: sshMatch[1].toLowerCase(), repo: sshMatch[2].toLowerCase() };
  }

  // HTTPS form: https://github.com/owner/repo(.git) (strip optional userinfo)
  const httpsMatch = trimmed.match(
    /^https?:\/\/(?:[^@/]+@)?github\.com\/([^/]+)\/([^/?#]+?)(?:\.git)?(?:[/?#].*)?$/i
  );
  if (httpsMatch) {
    return { owner: httpsMatch[1].toLowerCase(), repo: httpsMatch[2].toLowerCase() };
  }

  return null;
}

/** Format an `{owner, repo}` pair as `owner/repo` (lowercase). */
export function formatRepo(parts: { owner: string; repo: string }): string {
  return `${parts.owner.toLowerCase()}/${parts.repo.toLowerCase()}`;
}
