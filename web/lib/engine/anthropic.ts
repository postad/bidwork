import Anthropic from "@anthropic-ai/sdk";
import type { ZodType } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

// Lazy client so the env var is read at task runtime, not import time.
let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

export const MODELS = {
  // Relevance scan is semantic (the epoxy "anchor vs flooring" case proved keyword/Haiku
  // is too weak) → Sonnet. Extraction → Opus. Tiled counting → Sonnet.
  scan: process.env.MODEL_SCAN ?? "claude-sonnet-4-6",
  extract: process.env.MODEL_EXTRACT ?? "claude-opus-4-8",
  count: process.env.MODEL_COUNT ?? "claude-sonnet-4-6",
};

export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number };
export const emptyUsage = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

export function addUsage(a: Usage, m: Anthropic.Messages.Message): Usage {
  const u = m.usage;
  return {
    input: a.input + (u?.input_tokens ?? 0),
    output: a.output + (u?.output_tokens ?? 0),
    cacheRead: a.cacheRead + (u?.cache_read_input_tokens ?? 0),
    cacheWrite: a.cacheWrite + (u?.cache_creation_input_tokens ?? 0),
  };
}

/** PDF document block. Set `cache` to cache the document across per-trade calls
 *  (prompt caching ≈ 10% cost on cache reads) — the key token saving. */
export function pdfBlock(base64: string, cache = false): Anthropic.Messages.DocumentBlockParam {
  return {
    type: "document",
    source: { type: "base64", media_type: "application/pdf", data: base64 },
    ...(cache ? { cache_control: { type: "ephemeral" } } : {}),
  };
}

export function imageBlock(base64: string): Anthropic.Messages.ImageBlockParam {
  return { type: "image", source: { type: "base64", media_type: "image/png", data: base64 } };
}

function toInputSchema(schema: ZodType): Record<string, unknown> {
  const js = zodToJsonSchema(schema, { $refStrategy: "none", target: "jsonSchema7" }) as Record<string, unknown>;
  delete js.$schema;
  return js;
}

/**
 * Force the model to answer through one tool whose input_schema is `schema`'s
 * JSON Schema — so we always get a validated object, never prose. The same zod
 * schema validates the returned object (single source of truth).
 */
export async function structuredCall<T>(opts: {
  model: string;
  system: string;
  content: Anthropic.Messages.ContentBlockParam[];
  toolName: string;
  toolDescription: string;
  schema: ZodType<T>;
  maxTokens?: number;
}): Promise<{ data: T; message: Anthropic.Messages.Message }> {
  const message = await client().messages.create({
    model: opts.model,
    max_tokens: opts.maxTokens ?? 8000,
    system: opts.system,
    tools: [{ name: opts.toolName, description: opts.toolDescription, input_schema: toInputSchema(opts.schema) as Anthropic.Messages.Tool["input_schema"] }],
    tool_choice: { type: "tool", name: opts.toolName },
    messages: [{ role: "user", content: opts.content }],
  });
  const block = message.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") throw new Error("Model did not return a tool_use block");
  return { data: opts.schema.parse(block.input), message };
}
