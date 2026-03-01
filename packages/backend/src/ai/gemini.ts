import { GoogleGenAI, type Content, type FunctionDeclaration, type GenerateContentConfig } from "@google/genai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.warn("[ai] GEMINI_API_KEY not set — AI features will be unavailable");
}

const client = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

export const DEFAULT_MODEL = "gemini-2.0-flash";

export const TEMPERATURE = {
  query: 0.3,
  insight: 0.5,
  report: 0.4,
} as const;

export interface GeminiResponse {
  text: string;
  functionCalls: Array<{ name: string; args: Record<string, unknown> }>;
  inputTokens: number;
  outputTokens: number;
}

export function isAiAvailable(): boolean {
  return client !== null;
}

export async function callGemini(
  contents: Content[],
  tools?: FunctionDeclaration[],
  config?: { temperature?: number; model?: string; maxOutputTokens?: number }
): Promise<GeminiResponse> {
  if (!client) {
    throw new Error("AI features unavailable: GEMINI_API_KEY not configured");
  }

  const model = config?.model ?? DEFAULT_MODEL;

  const generateConfig: GenerateContentConfig = {
    temperature: config?.temperature ?? TEMPERATURE.query,
    maxOutputTokens: config?.maxOutputTokens ?? 8192,
  };

  if (tools && tools.length > 0) {
    generateConfig.tools = [{ functionDeclarations: tools }];
  }

  const response = await client.models.generateContent({
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

export async function callGeminiStreaming(
  contents: Content[],
  tools?: FunctionDeclaration[],
  config?: { temperature?: number; model?: string; maxOutputTokens?: number },
  onChunk?: (text: string) => void
): Promise<GeminiResponse> {
  if (!client) {
    throw new Error("AI features unavailable: GEMINI_API_KEY not configured");
  }

  const model = config?.model ?? DEFAULT_MODEL;

  const generateConfig: GenerateContentConfig = {
    temperature: config?.temperature ?? TEMPERATURE.query,
    maxOutputTokens: config?.maxOutputTokens ?? 8192,
  };

  if (tools && tools.length > 0) {
    generateConfig.tools = [{ functionDeclarations: tools }];
  }

  const response = await client.models.generateContentStream({
    model,
    contents,
    config: generateConfig,
  });

  let fullText = "";
  const allFunctionCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let inputTokens = 0;
  let outputTokens = 0;

  for await (const chunk of response) {
    const parts = chunk.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      if (part.text) {
        fullText += part.text;
        onChunk?.(part.text);
      }
      if (part.functionCall) {
        allFunctionCalls.push({
          name: part.functionCall.name!,
          args: (part.functionCall.args as Record<string, unknown>) ?? {},
        });
      }
    }
    if (chunk.usageMetadata) {
      inputTokens = chunk.usageMetadata.promptTokenCount ?? inputTokens;
      outputTokens = chunk.usageMetadata.candidatesTokenCount ?? outputTokens;
    }
  }

  return {
    text: fullText,
    functionCalls: allFunctionCalls,
    inputTokens,
    outputTokens,
  };
}
