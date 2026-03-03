import type { SQL } from "bun";
import { StateGraph, Annotation, END, START } from "@langchain/langgraph";
import {
  GoogleGenAI,
  type Content,
  type FunctionDeclaration,
  type GenerateContentConfig,
} from "@google/genai";
import { TEMPERATURE, DEFAULT_MODEL, isAiAvailable } from "../gemini";
import { getToolDeclarations, findTool } from "../tools";
import { recordTokenUsage } from "../../db";

/**
 * Internal Gemini caller that supports systemInstruction via the SDK's
 * dedicated field, preventing prompt-injection override of system prompts.
 */
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const geminiClient = GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: GEMINI_API_KEY })
  : null;

interface GeminiCallResult {
  text: string;
  functionCalls: Array<{ name: string; args: Record<string, unknown> }>;
  inputTokens: number;
  outputTokens: number;
}

async function callGeminiWithSystem(
  contents: Content[],
  systemInstruction: string,
  tools?: FunctionDeclaration[],
  config?: { temperature?: number; model?: string; maxOutputTokens?: number }
): Promise<GeminiCallResult> {
  if (!geminiClient) {
    throw new Error("AI features unavailable: GEMINI_API_KEY not configured");
  }

  const model = config?.model ?? DEFAULT_MODEL;

  const generateConfig: GenerateContentConfig = {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    temperature: config?.temperature ?? TEMPERATURE.query,
    maxOutputTokens: config?.maxOutputTokens ?? 8192,
  };

  if (tools && tools.length > 0) {
    generateConfig.tools = [{ functionDeclarations: tools }];
  }

  const response = await geminiClient.models.generateContent({
    model,
    contents,
    config: generateConfig,
  });

  const candidate = response.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];

  const text = parts
    .filter((p) => p.text)
    .map((p) => p.text)
    .join("");

  const functionCalls = parts
    .filter((p) => p.functionCall)
    .map((p) => ({
      name: p.functionCall!.name!,
      args: (p.functionCall!.args as Record<string, unknown>) ?? {},
    }));

  const usage = response.usageMetadata;

  return {
    text,
    functionCalls,
    inputTokens: usage?.promptTokenCount ?? 0,
    outputTokens: usage?.candidatesTokenCount ?? 0,
  };
}

const MAX_TOOL_ITERATIONS = 5;
const MAX_TOTAL_TOOL_CALLS = 10;

const SYSTEM_PROMPT = `You are DevScope AI, an intelligent assistant for a developer activity monitoring platform.
You have access to tools that query a PostgreSQL database containing developer session data, tool usage metrics, and project activity.

Guidelines:
- ALWAYS make reasonable assumptions and query data immediately. NEVER ask clarifying questions unless the query is truly impossible to answer.
- When the time period is unspecified, default to the last 30 days.
- When the scope is vague (e.g., "who's doing the most?", "what's happening?"), assume the broadest useful interpretation and use the most relevant tool (leaderboard, team health, activity overview, etc.).
- When the user mentions a developer by name, first use getAllDevelopers to resolve their name to an ID, then use that ID in subsequent queries.
- Always ground your answers in actual data from the tools. Never make up statistics.
- Present numbers clearly: use commas for thousands, percentages with 1 decimal place, durations in human-friendly format.
- When comparing periods, highlight significant changes (>20% delta).
- If the data is empty or insufficient, say so honestly rather than speculating.
- Keep responses concise but thorough. Use bullet points for lists of metrics.
- When asked about trends, include both the direction and magnitude of change.
- Prefer showing data and letting the user refine, rather than asking upfront what they want.`;

const QueryState = Annotation.Root({
  question: Annotation<string>,
  conversationHistory: Annotation<Content[]>,
  developerIds: Annotation<string[] | undefined>,
  intent: Annotation<"needs_data" | "general">,
  toolCallsQueue: Annotation<Array<{ name: string; args: Record<string, unknown> }>>,
  toolResults: Annotation<Array<{ name: string; result: string }>>,
  iterationCount: Annotation<number>,
  totalToolCalls: Annotation<number>,
  answer: Annotation<string>,
  inputTokens: Annotation<number>,
  outputTokens: Annotation<number>,
});

type QueryStateType = typeof QueryState.State;

function buildContents(
  history: Content[],
  userMessage: string
): Content[] {
  return [
    ...history,
    { role: "user", parts: [{ text: userMessage }] },
  ];
}

async function classifyIntent(
  state: QueryStateType
): Promise<Partial<QueryStateType>> {
  const contents = buildContents(
    state.conversationHistory,
    state.question
  );

  const response = await callGeminiWithSystem(contents, SYSTEM_PROMPT, getToolDeclarations(), {
    temperature: TEMPERATURE.query,
  });

  if (response.functionCalls.length > 0) {
    return {
      intent: "needs_data",
      toolCallsQueue: response.functionCalls.map((fc) => ({
        name: fc.name,
        args: fc.args,
      })),
      inputTokens: state.inputTokens + response.inputTokens,
      outputTokens: state.outputTokens + response.outputTokens,
    };
  }

  // No tool calls — general answer
  return {
    intent: "general",
    answer: response.text,
    inputTokens: state.inputTokens + response.inputTokens,
    outputTokens: state.outputTokens + response.outputTokens,
  };
}

function routeAfterClassify(
  state: QueryStateType
): "callTools" | "respond" {
  if (state.intent === "needs_data") return "callTools";
  return "respond";
}

async function callTools(
  state: QueryStateType,
  sql: SQL
): Promise<Partial<QueryStateType>> {
  const results: Array<{ name: string; result: string }> = [
    ...state.toolResults,
  ];
  let callsMade = 0;

  for (const tc of state.toolCallsQueue) {
    if (state.totalToolCalls + callsMade >= MAX_TOTAL_TOOL_CALLS) break;

    const tool = findTool(tc.name);
    if (!tool) {
      results.push({
        name: tc.name,
        result: JSON.stringify({ error: `Unknown tool: ${tc.name}` }),
      });
      callsMade++;
      continue;
    }

    try {
      const result = await tool.execute(sql, tc.args, state.developerIds);
      results.push({ name: tc.name, result });
    } catch (err) {
      results.push({
        name: tc.name,
        result: JSON.stringify({ error: String(err) }),
      });
    }
    callsMade++;
  }

  return {
    toolResults: results,
    toolCallsQueue: [],
    iterationCount: state.iterationCount + 1,
    totalToolCalls: state.totalToolCalls + callsMade,
  };
}

async function shouldContinue(
  state: QueryStateType
): Promise<Partial<QueryStateType>> {
  // Build conversation with tool results for Gemini to decide if more data is needed
  const toolResultParts = state.toolResults.map((tr) => ({
    functionResponse: {
      name: tr.name,
      response: { result: tr.result },
    },
  }));

  const contents: Content[] = [
    ...buildContents(state.conversationHistory, state.question),
    {
      role: "model",
      parts: state.toolResults.map((tr) => ({
        functionCall: { name: tr.name, args: {} },
      })),
    },
    { role: "user", parts: toolResultParts },
  ];

  const response = await callGeminiWithSystem(contents, SYSTEM_PROMPT, getToolDeclarations(), {
    temperature: TEMPERATURE.query,
  });

  if (
    response.functionCalls.length > 0 &&
    state.iterationCount < MAX_TOOL_ITERATIONS &&
    state.totalToolCalls < MAX_TOTAL_TOOL_CALLS
  ) {
    return {
      toolCallsQueue: response.functionCalls.map((fc) => ({
        name: fc.name,
        args: fc.args,
      })),
      inputTokens: state.inputTokens + response.inputTokens,
      outputTokens: state.outputTokens + response.outputTokens,
    };
  }

  // Ready to synthesize
  return {
    answer: response.text,
    toolCallsQueue: [],
    inputTokens: state.inputTokens + response.inputTokens,
    outputTokens: state.outputTokens + response.outputTokens,
  };
}

function routeAfterContinue(
  state: QueryStateType
): "callTools" | "respond" {
  if (state.toolCallsQueue.length > 0) return "callTools";
  return "respond";
}

// No-op respond node — answer is already set
async function respond(
  state: QueryStateType
): Promise<Partial<QueryStateType>> {
  return {};
}

export function createQueryWorkflow(sql: SQL) {
  const workflow = new StateGraph(QueryState)
    .addNode("classifyIntent", classifyIntent)
    .addNode("callTools", (state) => callTools(state, sql))
    .addNode("shouldContinue", shouldContinue)
    .addNode("respond", respond)
    .addEdge(START, "classifyIntent")
    .addConditionalEdges("classifyIntent", routeAfterClassify)
    .addEdge("callTools", "shouldContinue")
    .addConditionalEdges("shouldContinue", routeAfterContinue)
    .addEdge("respond", END);

  return workflow.compile();
}

export interface QueryResult {
  answer: string;
  inputTokens: number;
  outputTokens: number;
}

export async function runQueryWorkflow(
  sql: SQL,
  question: string,
  conversationHistory: Content[] = [],
  developerIds?: string[]
): Promise<QueryResult> {
  const app = createQueryWorkflow(sql);

  const result = await app.invoke({
    question,
    conversationHistory,
    developerIds,
    intent: "general" as const,
    toolCallsQueue: [],
    toolResults: [],
    iterationCount: 0,
    totalToolCalls: 0,
    answer: "",
    inputTokens: 0,
    outputTokens: 0,
  });

  await recordTokenUsage(sql, "chat", "gemini-2.0-flash", result.inputTokens, result.outputTokens);

  return {
    answer: result.answer,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  };
}

/**
 * Streaming variant: calls Gemini with full tool results to produce a streaming answer.
 * Returns a ReadableStream of SSE-formatted text chunks.
 */
export async function runQueryWorkflowStreaming(
  sql: SQL,
  question: string,
  conversationHistory: Content[] = [],
  developerIds?: string[]
): Promise<ReadableStream<Uint8Array>> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      try {
        // Phase 1: classify intent and call tools (non-streaming)
        const app = createQueryWorkflow(sql);
        const result = await app.invoke({
          question,
          conversationHistory,
          developerIds,
          intent: "general" as const,
          toolCallsQueue: [],
          toolResults: [],
          iterationCount: 0,
          totalToolCalls: 0,
          answer: "",
          inputTokens: 0,
          outputTokens: 0,
        });

        // If we already got an answer from the workflow (general/clarification or synthesized)
        // Stream it out character-by-character in chunks
        if (result.answer) {
          const answer = result.answer;
          // Send in chunks of ~50 chars for smooth streaming feel
          const chunkSize = 50;
          for (let i = 0; i < answer.length; i += chunkSize) {
            const chunk = answer.slice(i, i + chunkSize);
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "text", content: chunk })}\n\n`)
            );
          }
        }

        await recordTokenUsage(sql, "chat", "gemini-2.0-flash", result.inputTokens, result.outputTokens);

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (err) {
        console.error("[devscope] AI chat error:", err);
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "error", content: "An error occurred while processing your request. Please try again." })}\n\n`
          )
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    },
  });
}
