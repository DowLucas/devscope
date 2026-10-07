/**
 * Text a TTS voice (Kokoro) reads aloud, rewritten so technical shorthand comes
 * out right. Checked against Kokoro's own phonemizer (`/dev/phonemize`):
 *
 * - All-caps acronyms (API, CLI, PR, SSH) and vowel-less short words (npm, jq,
 *   gh, tsc) are already spelled letter by letter, so they are left alone.
 *   Spacing them out is worse: "A P I" reads the A as the article "uh".
 * - Some acronyms are words (JSON, YAML, README) and are spelled out wrongly,
 *   units after numbers are read as letters ("5s" is "fives", "1.2x" is "one
 *   point two ex"), version numbers lose their points, and identifiers run
 *   together ("useActivityStore").
 *
 * Idempotent, so text may pass through it more than once (a summary, then its
 * audio).
 */

/** Words read wrongly as written, matched whole, as they should be said. */
const LEXICON: Array<[RegExp, string]> = [
  [/\bREADME\b/gi, "read me"],
  [/\bCHANGELOG\b/gi, "change log"],
  [/\bJSON\b/gi, "jay-son"],
  [/\bJSONL\b/gi, "jay-son L"],
  [/\bYAML\b/gi, "yammel"],
  [/\bTOML\b/gi, "tommel"],
  [/\bWAV\b/g, "wave"],
  [/\bsrc\b/g, "source"],
  [/\bk8s\b/gi, "kubernetes"],
  [/\bkubectl\b/gi, "kube control"],
  [/\bstdin\b/g, "standard in"],
  [/\bstdout\b/g, "standard out"],
  [/\bstderr\b/g, "standard error"],
  [/\bPostgreSQL\b/g, "postgres"],
  [/\bntfy\b/g, "notify"],
  [/\bOAuth\b/g, "oh-auth"],
  [/\bnginx\b/gi, "engine x"],
  [/\bpgvector\b/g, "P G vector"],
];

/** File extensions, said after "dot". Unlisted ones stay as written. */
const EXTENSIONS: Record<string, string> = {
  json: "jay-son",
  jsonl: "jay-son L",
  md: "MD",
  ts: "TS",
  tsx: "TSX",
  js: "JS",
  jsx: "JSX",
  sh: "SH",
  py: "pie",
  yml: "yammel",
  yaml: "yammel",
  toml: "tommel",
  sql: "sequel",
  txt: "text",
  log: "log",
  env: "env",
  css: "CSS",
  html: "HTML",
  go: "go",
  rs: "RS",
};

/** Units after a number, singular and plural. */
const UNITS: Record<string, [string, string]> = {
  ms: ["millisecond", "milliseconds"],
  s: ["second", "seconds"],
  sec: ["second", "seconds"],
  m: ["minute", "minutes"],
  min: ["minute", "minutes"],
  h: ["hour", "hours"],
  d: ["day", "days"],
  k: ["thousand", "thousand"],
  KB: ["kilobyte", "kilobytes"],
  MB: ["megabyte", "megabytes"],
  GB: ["gigabyte", "gigabytes"],
  TB: ["terabyte", "terabytes"],
};

export function speakable(text: string): string {
  let t = text;

  // Latin abbreviations and "vs" ("ee jee", "viz").
  t = t
    .replace(/\be\.g\.(?=\W|$)/gi, "for example")
    .replace(/\bi\.e\.(?=\W|$)/gi, "that is")
    .replace(/\betc\.(?=\W|$)/gi, "et cetera")
    .replace(/\bvs\.?(?=\s)/gi, "versus");

  // Version numbers: "0.25.0" lost its points; "v2.1.0" is a version.
  t = t.replace(/\b(v)?(\d+)\.(\d+)\.(\d+)\b/g, (_m, v: string | undefined, a, b, c) =>
    `${v ? "version " : ""}${a} point ${b} point ${c}`,
  );

  // File names: "voice.json" -> "voice dot jay-son".
  t = t.replace(/\b([A-Za-z][\w-]*)\.([a-z]{1,5})\b(?![.\w])/g, (m, name: string, ext: string) =>
    ext in EXTENSIONS ? `${name} dot ${EXTENSIONS[ext]}` : m,
  );

  // Multipliers and units after numbers: "1.2x", "5s", "150ms", "30m", "40k", "2GB".
  t = t.replace(/\b(\d+(?:\.\d+)?)\s?x\b/g, "$1 times");
  t = t.replace(/\b(\d+(?:\.\d+)?)\s?(ms|sec|min|KB|MB|GB|TB|s|m|h|d|k)\b/g, (_m, n: string, unit: string) => {
    const [one, many] = UNITS[unit]!;
    return `${n} ${n === "1" ? one : many}`;
  });

  for (const [pattern, said] of LEXICON) t = t.replace(pattern, said);

  // Identifiers: snake_case and camelCase are read as one mushed word.
  t = t.replace(/(?<=\w)_+(?=\w)/g, " ").replace(/(^|\s)_+(?=\w)/g, "$1");
  // camelCase and PascalCase (two or more humps): "useActivityStore", "SessionTimeline".
  t = t.replace(/\b([A-Za-z][a-z]+)((?:[A-Z][a-z]+)+)\b/g, (_m, head: string, rest: string) =>
    `${head} ${rest.replace(/([a-z])(?=[A-Z])/g, "$1 ")}`,
  );

  return t.replace(/\s+/g, " ").trim();
}
