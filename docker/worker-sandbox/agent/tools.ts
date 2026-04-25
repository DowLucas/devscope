// Read-only filesystem tools for the sandbox agent. Each tool resolves its
// input path under `repoPath` and rejects any traversal outside that root.
// Output is always size-capped — the model must not be able to OOM us by
// asking for /usr/share/dict/words or running `grep -r '' /`.

import { readFile, readdir, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import * as path from "node:path";

export const READ_FILE_CAP_BYTES = 64 * 1024;
export const GREP_CAP_BYTES = 16 * 1024;
export const LIST_DIR_CAP_ENTRIES = 500;

/**
 * Resolve `p` under `repoPath`. Returns the absolute resolved path if it sits
 * inside `repoPath`; otherwise throws. We also reject absolute paths in `p`
 * itself — the model is meant to use repo-relative paths.
 */
export function safeResolve(repoPath: string, p: string): string {
  if (typeof p !== "string" || p.length === 0) {
    throw new Error("path must be a non-empty string");
  }
  // path.resolve(base, '/etc/passwd') returns '/etc/passwd' — block.
  if (path.isAbsolute(p)) {
    throw new Error(`absolute paths not allowed: ${p}`);
  }
  const root = path.resolve(repoPath);
  const resolved = path.resolve(root, p);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`path escapes repo root: ${p}`);
  }
  return resolved;
}

export async function toolReadFile(
  repoPath: string,
  input: { path: string }
): Promise<string> {
  const abs = safeResolve(repoPath, input.path);
  const buf = await readFile(abs);
  if (buf.length > READ_FILE_CAP_BYTES) {
    return (
      buf.slice(0, READ_FILE_CAP_BYTES).toString("utf8") +
      `\n\n[... truncated, file is ${buf.length} bytes, capped at ${READ_FILE_CAP_BYTES}]`
    );
  }
  return buf.toString("utf8");
}

export async function toolListDir(
  repoPath: string,
  input: { path: string }
): Promise<string> {
  const abs = safeResolve(repoPath, input.path);
  const entries = await readdir(abs, { withFileTypes: true });
  const lines: string[] = [];
  for (const e of entries.slice(0, LIST_DIR_CAP_ENTRIES)) {
    lines.push(`${e.isDirectory() ? "d" : "f"} ${e.name}`);
  }
  if (entries.length > LIST_DIR_CAP_ENTRIES) {
    lines.push(`[... truncated, ${entries.length} entries, showing first ${LIST_DIR_CAP_ENTRIES}]`);
  }
  return lines.join("\n");
}

export function toolGrep(
  repoPath: string,
  input: { pattern: string; glob?: string }
): string {
  if (typeof input.pattern !== "string" || input.pattern.length === 0) {
    throw new Error("grep pattern must be a non-empty string");
  }
  // Hard-cap the pattern length so the model cannot construct a 1MB regex.
  if (input.pattern.length > 200) {
    throw new Error("grep pattern too long (>200 chars)");
  }
  const args = ["-rnI", "--max-count=20"];
  if (input.glob && typeof input.glob === "string") {
    if (input.glob.length > 100) throw new Error("grep glob too long");
    args.push(`--include=${input.glob}`);
  }
  // -- separates flags from positional, then pattern, then path.
  // Pattern is passed as argv (no shell), so quoting is a non-issue.
  args.push("--", input.pattern, ".");
  const result = spawnSync("grep", args, {
    cwd: path.resolve(repoPath),
    encoding: "utf8",
    maxBuffer: GREP_CAP_BYTES * 4,
    timeout: 10_000,
  });
  // grep exits 1 when there are no matches; that is success-with-no-results.
  if (result.status !== 0 && result.status !== 1) {
    const err = (result.stderr || "").trim().slice(0, 200);
    throw new Error(`grep failed (exit ${result.status}): ${err}`);
  }
  let out = result.stdout || "";
  if (out.length === 0) return "(no matches)";
  if (out.length > GREP_CAP_BYTES) {
    out = out.slice(0, GREP_CAP_BYTES) + `\n[... truncated at ${GREP_CAP_BYTES} bytes]`;
  }
  return out;
}

/**
 * Existence check for tests — does NOT touch the filesystem state.
 */
export async function pathExists(repoPath: string, p: string): Promise<boolean> {
  try {
    const abs = safeResolve(repoPath, p);
    await stat(abs);
    return true;
  } catch {
    return false;
  }
}
