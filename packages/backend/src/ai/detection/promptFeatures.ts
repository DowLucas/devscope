/**
 * Local prompt feature extraction.
 *
 * Analyzes prompt text to extract structured features about how a developer
 * communicates with Claude Code. Features are computed locally — raw prompt
 * text is NEVER sent to the LLM. Only the extracted feature summary is
 * included in pattern analysis data.
 */

export interface PromptFeatures {
  /** Number of prompts that reference specific file paths */
  file_references: number;
  /** Number of prompts that reference specific function/class names (camelCase/PascalCase identifiers) */
  code_references: number;
  /** Number of prompts phrased as questions ("how", "why", "what", "?") */
  questions: number;
  /** Number of prompts phrased as directives ("fix", "add", "create", "refactor", "update", "remove") */
  directives: number;
  /** Number of prompts that include error messages or stack traces */
  includes_errors: number;
  /** Number of prompts that mention slash commands (/commit, /clear, etc.) */
  slash_commands: number;
  /** Average specificity score 0-1 (higher = more specific prompts) */
  avg_specificity: number;
  /** Fraction of prompts with available text (vs metadata-only) */
  text_available_ratio: number;
}

const FILE_PATH_PATTERN = /(?:\/[\w.-]+){2,}|[\w.-]+\/[\w.-]+\.[\w]+/;
const CODE_IDENTIFIER_PATTERN = /\b[a-z][a-zA-Z0-9]{2,}(?:[A-Z][a-zA-Z0-9]*)+\b|\b[A-Z][a-zA-Z0-9]{2,}\b/;
// Mixed anchoring: "?" matches anywhere (mid-sentence questions), while keyword
// alternatives are start-anchored (^) so "how do I..." only matches at the beginning.
const QUESTION_PATTERN = /\?|^(how|why|what|where|when|which|can you|could you|is there|does|do)\b/i;
// Start-anchored (^): only matches when the prompt begins with a directive verb,
// avoiding false positives on mid-sentence occurrences like "I need to fix...".
const DIRECTIVE_PATTERN = /^(fix|add|create|refactor|update|remove|delete|change|move|rename|implement|write|build|set up|install|configure|migrate|convert|replace|extract|split|merge|optimize|debug|test|run|deploy|push|commit)\b/i;
const ERROR_PATTERN = /error:|Error:|ERROR|stack trace|traceback|exception|failed|TypeError|ReferenceError|SyntaxError|at .+:\d+:\d+/;
const SLASH_COMMAND_PATTERN = /\/(?:commit|clear|help|review|init|config|compact|memory|status|cost|doctor|bug|login|logout)\b/;

function computeSpecificity(text: string): number {
  let score = 0;
  let factors = 0;

  // File paths increase specificity
  factors++;
  if (FILE_PATH_PATTERN.test(text)) score += 1;

  // Code identifiers increase specificity
  factors++;
  if (CODE_IDENTIFIER_PATTERN.test(text)) score += 1;

  // Longer prompts tend to be more specific (up to a point)
  factors++;
  const wordCount = text.split(/\s+/).length;
  if (wordCount >= 10 && wordCount <= 200) score += 1;
  else if (wordCount >= 5) score += 0.5;

  // Including error context is specific
  factors++;
  if (ERROR_PATTERN.test(text)) score += 1;

  // Line numbers are very specific
  factors++;
  if (/line \d+|:\d+:\d+|L\d+/i.test(text)) score += 1;

  return factors > 0 ? score / factors : 0;
}

/**
 * Extract structured features from an array of prompt texts.
 * Texts may be undefined/null for sessions without DEVSCOPE_SHARE_DETAILS.
 */
export function extractPromptFeatures(
  promptTexts: (string | null | undefined)[]
): PromptFeatures {
  const total = promptTexts.length;
  if (total === 0) {
    return {
      file_references: 0,
      code_references: 0,
      questions: 0,
      directives: 0,
      includes_errors: 0,
      slash_commands: 0,
      avg_specificity: 0,
      text_available_ratio: 0,
    };
  }

  let fileRefs = 0;
  let codeRefs = 0;
  let questions = 0;
  let directives = 0;
  let includesErrors = 0;
  let slashCommands = 0;
  let specificitySum = 0;
  let textCount = 0;

  for (const text of promptTexts) {
    if (!text) continue;
    textCount++;

    if (FILE_PATH_PATTERN.test(text)) fileRefs++;
    if (CODE_IDENTIFIER_PATTERN.test(text)) codeRefs++;
    if (QUESTION_PATTERN.test(text)) questions++;
    if (DIRECTIVE_PATTERN.test(text)) directives++;
    if (ERROR_PATTERN.test(text)) includesErrors++;
    if (SLASH_COMMAND_PATTERN.test(text)) slashCommands++;
    specificitySum += computeSpecificity(text);
  }

  return {
    file_references: fileRefs,
    code_references: codeRefs,
    questions,
    directives,
    includes_errors: includesErrors,
    slash_commands: slashCommands,
    avg_specificity: textCount > 0
      ? Math.round((specificitySum / textCount) * 1000) / 1000
      : 0,
    text_available_ratio: Math.round((textCount / total) * 1000) / 1000,
  };
}
