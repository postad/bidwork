import Anthropic from "@anthropic-ai/sdk";

// Lazy + memoized: constructed on first use, AFTER run.ts has loaded ../.env.
// (Static ESM imports evaluate before the importer's body, so a module-level
//  `new Anthropic()` would capture an undefined key.)
let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

export const MODELS = {
  triage: process.env.MODEL_TRIAGE ?? "claude-haiku-4-5-20251001",
  extract: process.env.MODEL_EXTRACT ?? "claude-opus-4-8",
  count: process.env.MODEL_COUNT ?? "claude-sonnet-4-6",
};

export type Usage = { input: number; output: number };

export function addUsage(a: Usage, m: Anthropic.Messages.Message): Usage {
  return {
    input: a.input + (m.usage?.input_tokens ?? 0),
    output: a.output + (m.usage?.output_tokens ?? 0),
  };
}

/** A PDF document content block built from base64 (≤32 MB, ≤100 pages). */
export function pdfBlock(base64: string): Anthropic.Messages.DocumentBlockParam {
  return { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } };
}

/** A PNG image content block from base64. */
export function imageBlock(base64: string): Anthropic.Messages.ImageBlockParam {
  return { type: "image", source: { type: "base64", media_type: "image/png", data: base64 } };
}

/**
 * Force the model to answer through a single tool whose input_schema is the
 * structured shape we want — the model literally cannot return prose, so we
 * always get a validated object back.
 */
export async function structuredCall(opts: {
  model: string;
  system: string;
  content: Anthropic.Messages.ContentBlockParam[];
  toolName: string;
  toolDescription: string;
  inputSchema: Record<string, unknown>;
  maxTokens?: number;
}): Promise<{ data: unknown; message: Anthropic.Messages.Message }> {
  const message = await client().messages.create({
    model: opts.model,
    max_tokens: opts.maxTokens ?? 8000,
    system: opts.system,
    tools: [{ name: opts.toolName, description: opts.toolDescription, input_schema: opts.inputSchema as any }],
    tool_choice: { type: "tool", name: opts.toolName },
    messages: [{ role: "user", content: opts.content }],
  });
  const block = message.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") throw new Error("Model did not return a tool_use block");
  return { data: block.input, message };
}
