import type { SQL } from "bun";
import type { FunctionDeclaration } from "@google/genai";
import { Type } from "@google/genai";
import {
  getDeveloperActivityOverTime,
  getToolUsageBreakdown,
  getSessionStats,
  getSessionStatsSummary,
  getDeveloperLeaderboard,
  getHourlyDistribution,
  getPeriodComparison,
  getDeveloperComparison,
  getToolFailureRates,
  getFailureClusters,
  getTeamHealth,
  getProjectsOverview,
  getProjectContributors,
  getProjectActivityOverTime,
  getAllDevelopers,
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
      name: "getDeveloperLeaderboard",
      description:
        "Get developer leaderboard ranked by total events. Shows sessions, prompts, tool calls per developer.",
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
      const result = await getDeveloperLeaderboard(
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
      name: "getDeveloperComparison",
      description:
        "Compare multiple developers side-by-side on sessions, prompts, tool calls, failures, and avg session duration.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          developerIds: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Array of developer IDs to compare",
          },
          days: {
            type: Type.NUMBER,
            description: "Number of days to look back (default 30, max 365)",
          },
        },
        required: ["developerIds"],
      },
    },
    execute: async (sql, args, developerIds) => {
      const result = await getDeveloperComparison(
        sql,
        args.developerIds as string[],
        clampDays(args.days as number | undefined),
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
      name: "getTeamHealth",
      description:
        "Get comprehensive team health data: developer statuses, velocity trends (week-over-week), stuck sessions, and workload distribution.",
      parameters: {
        type: Type.OBJECT,
        properties: {},
      },
    },
    execute: async (sql, _args, developerIds) => {
      const result = await getTeamHealth(sql, developerIds);
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
];

export function getToolDeclarations(): FunctionDeclaration[] {
  return toolRegistry.map((t) => t.declaration);
}

export function findTool(name: string): ToolDefinition | undefined {
  return toolRegistry.find((t) => t.declaration.name === name);
}
