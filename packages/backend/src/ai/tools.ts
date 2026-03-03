import type { SQL } from "bun";
import type { FunctionDeclaration } from "@google/genai";
import { Type } from "@google/genai";
import {
  getDeveloperActivityOverTime,
  getToolUsageBreakdown,
  getSessionStats,
  getSessionStatsSummary,
  getTeamActivitySummary,
  getHourlyDistribution,
  getPeriodComparison,
  getToolFailureRates,
  getFailureClusters,
  getProjectsOverview,
  getProjectContributors,
  getProjectActivityOverTime,
  getAllDevelopers,
  getPatterns,
  getPatternStats,
  getAntiPatterns,
  getAntiPatternStats,
} from "../db";

const MAX_DAYS = 365;
const MAX_RESULT_SIZE = 15_000; // 15KB

function clampDays(days?: number): number {
  return Math.min(Math.max(days ?? 30, 1), MAX_DAYS);
}

function truncateResult(data: unknown): string {
  const json = JSON.stringify(data);
  if (json.length <= MAX_RESULT_SIZE) return json;
  // Truncate arrays by removing items from the end
  if (Array.isArray(data)) {
    let truncated = [...data];
    while (JSON.stringify(truncated).length > MAX_RESULT_SIZE && truncated.length > 1) {
      truncated = truncated.slice(0, Math.ceil(truncated.length * 0.75));
    }
    return JSON.stringify({
      data: truncated,
      _truncated: true,
      _original_count: data.length,
      _returned_count: truncated.length,
    });
  }
  return json.slice(0, MAX_RESULT_SIZE) + "...(truncated)";
}

export interface ToolDefinition {
  declaration: FunctionDeclaration;
  execute: (sql: SQL, args: Record<string, unknown>, developerIds?: string[]) => Promise<string>;
}

export const toolRegistry: ToolDefinition[] = [
  {
    declaration: {
      name: "getDeveloperActivityOverTime",
      description:
        "Get daily activity metrics (events, sessions, prompts, tool calls) over time. Optionally filter by developer.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          developerId: {
            type: Type.STRING,
            description: "Optional developer ID to filter by",
          },
          days: {
            type: Type.NUMBER,
            description: "Number of days to look back (default 30, max 365)",
          },
        },
      },
    },
    execute: async (sql, args, developerIds) => {
      if (args.developerId && developerIds && !developerIds.includes(args.developerId as string)) {
        return JSON.stringify({ error: "Invalid developer ID" });
      }
      const result = await getDeveloperActivityOverTime(
        sql,
        args.developerId as string | undefined,
        clampDays(args.days as number | undefined),
        developerIds
      );
      return truncateResult(result);
    },
  },
  {
    declaration: {
      name: "getToolUsageBreakdown",
      description:
        "Get tool usage breakdown showing success/failure counts per tool. Returns top 15 tools by usage.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          developerId: {
            type: Type.STRING,
            description: "Optional developer ID to filter by",
          },
          days: {
            type: Type.NUMBER,
            description: "Number of days to look back (default 30, max 365)",
          },
        },
      },
    },
    execute: async (sql, args, developerIds) => {
      if (args.developerId && developerIds && !developerIds.includes(args.developerId as string)) {
        return JSON.stringify({ error: "Invalid developer ID" });
      }
      const result = await getToolUsageBreakdown(
        sql,
        args.developerId as string | undefined,
        clampDays(args.days as number | undefined),
        developerIds
      );
      return truncateResult(result);
    },
  },
  {
    declaration: {
      name: "getSessionStats",
      description:
        "Get daily session statistics: session count, average duration, total duration.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          developerId: {
            type: Type.STRING,
            description: "Optional developer ID to filter by",
          },
          days: {
            type: Type.NUMBER,
            description: "Number of days to look back (default 30, max 365)",
          },
        },
      },
    },
    execute: async (sql, args, developerIds) => {
      if (args.developerId && developerIds && !developerIds.includes(args.developerId as string)) {
        return JSON.stringify({ error: "Invalid developer ID" });
      }
      const result = await getSessionStats(
        sql,
        args.developerId as string | undefined,
        clampDays(args.days as number | undefined),
        developerIds
      );
      return truncateResult(result);
    },
  },
  {
    declaration: {
      name: "getSessionStatsSummary",
      description:
        "Get summary statistics: total sessions, average duration, active days, unique developers.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          developerId: {
            type: Type.STRING,
            description: "Optional developer ID to filter by",
          },
          days: {
            type: Type.NUMBER,
            description: "Number of days to look back (default 30, max 365)",
          },
        },
      },
    },
    execute: async (sql, args, developerIds) => {
      if (args.developerId && developerIds && !developerIds.includes(args.developerId as string)) {
        return JSON.stringify({ error: "Invalid developer ID" });
      }
      const result = await getSessionStatsSummary(
        sql,
        args.developerId as string | undefined,
        clampDays(args.days as number | undefined),
        developerIds
      );
      return truncateResult(result);
    },
  },
  {
    declaration: {
      name: "getTeamActivitySummary",
      description:
        "Get aggregate team activity summary: total sessions, prompts, tool calls, and active developer count. No individual developer data.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          days: {
            type: Type.NUMBER,
            description: "Number of days to look back (default 30, max 365)",
          },
        },
      },
    },
    execute: async (sql, args, developerIds) => {
      const result = await getTeamActivitySummary(
        sql,
        clampDays(args.days as number | undefined),
        developerIds
      );
      return truncateResult(result);
    },
  },
  {
    declaration: {
      name: "getHourlyDistribution",
      description:
        "Get event count distribution by hour of day (0-23). Shows when developers are most active.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          developerId: {
            type: Type.STRING,
            description: "Optional developer ID to filter by",
          },
          days: {
            type: Type.NUMBER,
            description: "Number of days to look back (default 30, max 365)",
          },
        },
      },
    },
    execute: async (sql, args, developerIds) => {
      if (args.developerId && developerIds && !developerIds.includes(args.developerId as string)) {
        return JSON.stringify({ error: "Invalid developer ID" });
      }
      const result = await getHourlyDistribution(
        sql,
        args.developerId as string | undefined,
        clampDays(args.days as number | undefined),
        developerIds
      );
      return truncateResult(result);
    },
  },
  {
    declaration: {
      name: "getPeriodComparison",
      description:
        "Compare metrics between current period and previous period of same length. Shows sessions, prompts, tool calls, failures, and percent change.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          days: {
            type: Type.NUMBER,
            description:
              "Period length in days (default 7). Compares last N days vs prior N days.",
          },
          developerId: {
            type: Type.STRING,
            description: "Optional developer ID to filter by",
          },
        },
      },
    },
    execute: async (sql, args, developerIds) => {
      if (args.developerId && developerIds && !developerIds.includes(args.developerId as string)) {
        return JSON.stringify({ error: "Invalid developer ID" });
      }
      const result = await getPeriodComparison(
        sql,
        clampDays(args.days as number | undefined),
        args.developerId as string | undefined,
        developerIds
      );
      return truncateResult(result);
    },
  },
  {
    declaration: {
      name: "getToolFailureRates",
      description:
        "Get daily failure rates per tool. Shows success/failure counts and failure rate percentage.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          days: {
            type: Type.NUMBER,
            description: "Number of days to look back (default 30, max 365)",
          },
          developerId: {
            type: Type.STRING,
            description: "Optional developer ID to filter by",
          },
        },
      },
    },
    execute: async (sql, args, developerIds) => {
      if (args.developerId && developerIds && !developerIds.includes(args.developerId as string)) {
        return JSON.stringify({ error: "Invalid developer ID" });
      }
      const result = await getToolFailureRates(
        sql,
        clampDays(args.days as number | undefined),
        args.developerId as string | undefined,
        developerIds
      );
      return truncateResult(result);
    },
  },
  {
    declaration: {
      name: "getFailureClusters",
      description:
        "Find clusters of tool failures (2+ failures of same tool in same session). Includes error messages.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          days: {
            type: Type.NUMBER,
            description: "Number of days to look back (default 30, max 365)",
          },
        },
      },
    },
    execute: async (sql, args, developerIds) => {
      const result = await getFailureClusters(
        sql,
        clampDays(args.days as number | undefined),
        developerIds
      );
      return truncateResult(result);
    },
  },
  {
    declaration: {
      name: "getProjectsOverview",
      description:
        "Get overview of all projects with sessions, events, duration, contributors, failure rates, and health scores.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          days: {
            type: Type.NUMBER,
            description: "Number of days to look back (default 30, max 365)",
          },
        },
      },
    },
    execute: async (sql, args, developerIds) => {
      const result = await getProjectsOverview(
        sql,
        clampDays(args.days as number | undefined),
        developerIds
      );
      return truncateResult(result);
    },
  },
  {
    declaration: {
      name: "getProjectContributors",
      description:
        "Get contributors for a specific project with session counts and prompt counts.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          projectName: {
            type: Type.STRING,
            description: "The project name to get contributors for",
          },
          days: {
            type: Type.NUMBER,
            description: "Number of days to look back (default 30, max 365)",
          },
        },
        required: ["projectName"],
      },
    },
    execute: async (sql, args, developerIds) => {
      const result = await getProjectContributors(
        sql,
        args.projectName as string,
        clampDays(args.days as number | undefined),
        developerIds
      );
      return truncateResult(result);
    },
  },
  {
    declaration: {
      name: "getProjectActivityOverTime",
      description:
        "Get daily activity metrics for a specific project over time.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          projectName: {
            type: Type.STRING,
            description: "The project name to get activity for",
          },
          days: {
            type: Type.NUMBER,
            description: "Number of days to look back (default 30, max 365)",
          },
        },
        required: ["projectName"],
      },
    },
    execute: async (sql, args, developerIds) => {
      const result = await getProjectActivityOverTime(
        sql,
        args.projectName as string,
        clampDays(args.days as number | undefined),
        developerIds
      );
      return truncateResult(result);
    },
  },
  {
    declaration: {
      name: "getAllDevelopers",
      description:
        "Get all developers with their names, emails, and active session counts. Use this to resolve developer names to IDs before calling other tools.",
      parameters: {
        type: Type.OBJECT,
        properties: {},
      },
    },
    execute: async (sql, _args, developerIds) => {
      const result = await getAllDevelopers(sql, developerIds);
      return truncateResult(result);
    },
  },
  {
    declaration: {
      name: "getSessionPatterns",
      description:
        "Get discovered workflow patterns with effectiveness ratings, occurrence counts, and categories. Use this to understand what tool usage patterns lead to success or failure.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          effectiveness: {
            type: Type.STRING,
            description:
              'Filter by effectiveness: "effective", "neutral", or "ineffective"',
          },
          category: {
            type: Type.STRING,
            description:
              'Filter by category: "testing", "refactoring", "debugging", "exploration", "writing", "other"',
          },
          days: {
            type: Type.NUMBER,
            description: "Number of days to look back for stats (default 30)",
          },
        },
      },
    },
    execute: async (sql, args) => {
      if (args.effectiveness || args.category) {
        const result = await getPatterns(sql, {
          effectiveness: args.effectiveness as string | undefined,
          category: args.category as string | undefined,
          limit: 20,
        });
        return truncateResult(result);
      }
      const result = await getPatternStats(
        sql,
        clampDays(args.days as number | undefined)
      );
      return truncateResult(result);
    },
  },
  {
    declaration: {
      name: "getAntiPatternData",
      description:
        "Get detected anti-patterns (retry loops, failure cascades, abandoned sessions) with severity and improvement suggestions.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          severity: {
            type: Type.STRING,
            description:
              'Filter by severity: "info", "warning", or "critical"',
          },
          days: {
            type: Type.NUMBER,
            description: "Number of days for trend data (default 30)",
          },
        },
      },
    },
    execute: async (sql, args) => {
      if (args.severity) {
        const result = await getAntiPatterns(sql, {
          severity: args.severity as string,
          limit: 20,
        });
        return truncateResult(result);
      }
      const result = await getAntiPatternStats(
        sql,
        clampDays(args.days as number | undefined)
      );
      return truncateResult(result);
    },
  },
];

export function getToolDeclarations(): FunctionDeclaration[] {
  return toolRegistry.map((t) => t.declaration);
}

export function findTool(name: string): ToolDefinition | undefined {
  return toolRegistry.find((t) => t.declaration.name === name);
}
