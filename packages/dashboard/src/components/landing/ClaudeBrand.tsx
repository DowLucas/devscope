import type { ReactNode } from "react";

/* ------------------------------------------------------------------ */
/*  Utility to highlight "Claude Code" in Claude's brand color         */
/* ------------------------------------------------------------------ */

const CLAUDE_COLOR = "#DE7356";

/** Inline <span> that renders "Claude Code" in Claude's brand terracotta. */
export function ClaudeBrand() {
  return <span style={{ color: CLAUDE_COLOR }}>Claude Code</span>;
}

/**
 * Takes a plain string and returns JSX with every occurrence of
 * "Claude Code" rendered in Claude's brand color.
 */
export function brandify(text: string): ReactNode {
  const parts = text.split(/(Claude Code)/g);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    part === "Claude Code" ? (
      <span key={i} style={{ color: CLAUDE_COLOR }}>
        Claude Code
      </span>
    ) : (
      part
    )
  );
}
