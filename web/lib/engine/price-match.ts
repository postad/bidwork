import { MODELS, addUsage, emptyUsage, structuredCall, type Usage } from "./anthropic";
import { RateMatchResult } from "./schemas/price-match";

/** A learned correction the contractor made on a past out-of-envelope item. Empty
 *  until the Pillar-3 write-back lands; the match step already consults it. */
export interface MemoryEntry {
  situation: string; // e.g. "oversized blind ~20 ft"
  matchedSystem?: string; // a learned system/option name, if any
  note?: string;
}

export interface AreaMatch {
  rate: number | null; // resolved from the contractor's list — null = unpriced
  matchedSystem: string | null;
  source: "rate_card" | "memory" | "unpriced";
  confidence: number;
  reason: string;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

const SYSTEM =
  `You match a flooring project's scope to a contractor's OWN price list. For each area (a room/zone with a floor system + square footage), decide which price-list entry applies, using trade judgment — e.g. "grind & seal concrete" reasonably maps to a listed "grind & polish concrete"; "sealed concrete" maps to a sealed/polished concrete entry; but "carpet tile" does NOT map to any concrete system.\n\n` +
  `RULES:\n` +
  `- Return the EXACT price-list system name (copied verbatim) that applies, or null.\n` +
  `- NEVER invent or output a price/number — you only choose a name. The rate is taken from the list downstream.\n` +
  `- If NO listed system reasonably applies, set matchedSystem=null and source="unpriced". Do NOT force a wrong match to avoid a blank — a flagged unpriced item is correct and safe.\n` +
  `- If a past learned correction (memory) fits better than any list entry, use it and set source="memory".\n` +
  `- Give every decision a confidence (0..1) and a one-line reason. Return one entry per area, by areaIndex.`;

/**
 * AI pricing-match — the semantic step that replaces brittle string matching. The
 * model selects which rate-card system applies to each area (or flags it unpriced);
 * this function then resolves the chosen NAME back to the contractor's real rate, so
 * no price is ever fabricated. Quantities + arithmetic stay deterministic downstream.
 */
export async function matchScopeToRates(
  areas: { system: string; sqft: number; location?: string }[],
  systems: { name: string; perSqft: number }[],
  memory: MemoryEntry[] = [],
): Promise<{ matches: AreaMatch[]; usage: Usage }> {
  if (!areas.length) return { matches: [], usage: emptyUsage() };
  // No rate card at all → everything is unpriced (nothing to match against).
  if (!systems.length) {
    return {
      matches: areas.map(() => ({ rate: null, matchedSystem: null, source: "unpriced" as const, confidence: 1, reason: "No systems in your price list yet." })),
      usage: emptyUsage(),
    };
  }

  const listText = systems.map((s) => `- "${s.name}" ($${s.perSqft}/SF)`).join("\n");
  const memText = memory.length ? `\nPast learned corrections (memory):\n${memory.map((m) => `- ${m.situation}${m.matchedSystem ? ` → "${m.matchedSystem}"` : ""}${m.note ? ` (${m.note})` : ""}`).join("\n")}\n` : "";
  const areaText = areas.map((a, i) => `[${i}] ${a.location ? `${a.location}: ` : ""}system="${a.system}", ${a.sqft} SF`).join("\n");

  // The AI match must NEVER take down the whole bid. If the call fails (API error,
  // schema mismatch), degrade to all-unpriced (flagged) lines so the draft still gets
  // created + gated — and log the real error so we can fix the match itself.
  let data: RateMatchResult;
  let usage: Usage = emptyUsage();
  try {
    const res = await structuredCall({
      model: MODELS.scan, // semantic matching — same reasoning tier as the relevance scan
      system: SYSTEM,
      content: [
        {
          type: "text",
          text: `Contractor's price list (the ONLY systems you may match to):\n${listText}\n${memText}\nProject areas to match:\n${areaText}\n\nReturn one decision per area.`,
        },
      ],
      toolName: "report_matches",
      toolDescription: "For each scope area, which price-list system applies (by name) or unpriced.",
      schema: RateMatchResult,
      maxTokens: 2000,
    });
    data = res.data;
    usage = addUsage(emptyUsage(), res.message);
  } catch (e) {
    console.error("price-match failed — degrading to unpriced (bid still created)", { error: (e as Error)?.message, areas: areas.length, systems: systems.length });
    return {
      matches: areas.map(() => ({ rate: null as number | null, matchedSystem: null, source: "unpriced" as const, confidence: 0, reason: "Pricing match unavailable — please set this line's price." })),
      usage: emptyUsage(),
    };
  }

  // Resolve each chosen NAME back to the contractor's actual rate (deterministic) —
  // the AI never supplies a number, so a price can't be hallucinated. An unknown
  // name (model slip) is treated as unpriced rather than guessed.
  const byName = new Map(systems.map((s) => [norm(s.name), s.perSqft]));
  const byIndex = new Map(data.matches.map((m) => [m.areaIndex, m]));

  const matches: AreaMatch[] = areas.map((_, i) => {
    const m = byIndex.get(i);
    if (!m || !m.matchedSystem) return { rate: null, matchedSystem: null, source: "unpriced", confidence: m?.confidence ?? 0.5, reason: m?.reason ?? "No matching system." };
    const rate = byName.get(norm(m.matchedSystem));
    if (rate == null) return { rate: null, matchedSystem: null, source: "unpriced", confidence: m.confidence, reason: `Matched "${m.matchedSystem}" but it's not in your price list — needs your price.` };
    return { rate, matchedSystem: m.matchedSystem, source: m.source === "memory" ? "memory" : "rate_card", confidence: m.confidence, reason: m.reason };
  });

  return { matches, usage };
}
