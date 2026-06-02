import { z } from "zod";

// Per-chunk output of the multi-trade relevance scan. The model scores EVERY trade
// in one pass over the same (prompt-cached) pages.
export const ScanChunkResult = z.object({
  trades: z
    .array(
      z.object({
        slug: z.string().describe("The trade slug exactly as provided"),
        scopePresent: z.boolean().describe("Is there BIDDABLE scope for this trade in these pages? Judge semantically — not by keyword frequency."),
        confidence: z.number().min(0).max(1),
        reason: z.string(),
        relevantPages: z
          .array(
            z.object({
              pageInChunk: z.number().int().describe("1-based page number within THIS chunk"),
              kind: z.string().describe("e.g. schedule, plan, elevation, spec, finish_legend, title_block"),
            }),
          )
          .describe("Only pages that matter for THIS trade. Empty if no scope."),
      }),
    )
    .describe("One entry for EVERY trade slug provided, even if scopePresent is false."),
  contacts: z
    .array(
      z.object({
        name: z.string(),
        role: z.string().describe("GC | Architect | Owner | Designer | Engineer | Other"),
        company: z.string().nullable(),
        email: z.string().nullable().describe("null if not found — email is the unit for the network"),
        source: z.string().describe("Where found, e.g. 'title block A-000'"),
      }),
    )
    .describe("Project-team contacts found in title blocks / spec covers. Shared across all trades."),
});

export type ScanChunkResult = z.infer<typeof ScanChunkResult>;
