import { MODELS, addUsage, emptyUsage, structuredCall, type Usage } from "./anthropic";
import { WtMatchResult } from "./schemas/wt-match";
import type { Scope, PricingDNA } from "./price";
import type { MemoryEntry } from "./price-match";

export interface ItemEnvelope {
  inEnvelope: boolean;
  reason: string;
}
export interface WtEnvelope {
  motorized: ItemEnvelope[]; // aligned to scope.motorizedSets
  blinds: ItemEnvelope[]; // aligned to scope.blinds
}

const SYSTEM =
  `You are a sanity check on a WINDOW-TREATMENT bid before it's priced. The contractor prices NORMAL windows automatically from their size/ganging tiers. Your ONLY job is to catch the rare ABNORMAL item that those tiers would misprice, so it gets flagged for the contractor instead of a wrong auto-price.\n\n` +
  `Flag an item inEnvelope=FALSE only when it is CLEARLY abnormal, e.g.:\n` +
  `- a blind/shade far larger than normal (rough rule: width over ~10 ft / 120") — needs freight, multi-section, extra crew;\n` +
  `- an unusual configuration the standard tiers wouldn't capture;\n` +
  `- a product the contractor doesn't list at all.\n\n` +
  `EVERYTHING ELSE is inEnvelope=TRUE. A 15" door blind and a 3 ft blind are both NORMAL — the width tiers handle them; do NOT flag normal size variation. WHEN IN DOUBT, inEnvelope=TRUE. Return one verdict per item, by index, for both lists.`;

/**
 * The WT half of the AI pricing-match: a conservative out-of-envelope guard. It does
 * NOT match or price (the ganging/width tier math is deterministic and validated) —
 * it only flags the genuinely abnormal item (an oversized blind, an unsupported
 * product) so priceScope leaves it unpriced for the contractor instead of silently
 * tier-pricing it. Biased to in-envelope so normal packages are byte-identical.
 */
export async function checkWtEnvelope(scope: Scope, dna: PricingDNA, memory: MemoryEntry[] = []): Promise<{ env: WtEnvelope; usage: Usage }> {
  const allOk = (n: number): ItemEnvelope[] => Array.from({ length: n }, () => ({ inEnvelope: true, reason: "normal" }));

  // Nothing sizeable to judge → everything in-envelope (no AI call).
  if (!scope.motorizedSets.length && !scope.blinds.length) {
    return { env: { motorized: [], blinds: [] }, usage: emptyUsage() };
  }

  const widthTiers = dna.rates.MB.byWidthTier.map((t) => `≤${t.maxWidthInches}"`).join(", ");
  const ganging = Object.keys(dna.rates.WT.byShadesPerMotor).join(", ");
  const memText = memory.length ? `\nPast learned corrections (memory):\n${memory.map((m) => `- ${m.situation}${m.note ? ` (${m.note})` : ""}`).join("\n")}\n` : "";
  const motorText = scope.motorizedSets.map((s, i) => `[${i}] motorized roller, ${s.shadesPerMotor} on 1 motor${s.location ? `, ${s.location}` : ""}`).join("\n") || "(none)";
  const blindText = scope.blinds.map((b, i) => `[${i}] manual blind, ${b.widthInches != null ? `${b.widthInches}" wide` : "width unknown"}${b.location ? `, ${b.location}` : ""}`).join("\n") || "(none)";

  try {
    const { data, message } = await structuredCall({
      model: MODELS.scan,
      system: SYSTEM,
      content: [
        {
          type: "text",
          text:
            `Contractor's price tiers — ganging: ${ganging || "(none)"}; blind widths: ${widthTiers || "(none)"}.\n${memText}\n` +
            `MOTORIZED SETS:\n${motorText}\n\nBLINDS:\n${blindText}\n\nFor BOTH lists, return one verdict per item by index (most should be inEnvelope=true).`,
        },
      ],
      toolName: "report_envelope",
      toolDescription: "Per-item: is this a normal window the tiers price, or abnormal/oversized to flag?",
      schema: WtMatchResult,
      maxTokens: 1500,
    });

    const pick = (verdicts: { index: number; inEnvelope: boolean; reason: string }[], n: number): ItemEnvelope[] => {
      const byIndex = new Map(verdicts.map((v) => [v.index, v]));
      // Default missing/true → in-envelope (conservative: never flag what the model didn't clearly call abnormal).
      return Array.from({ length: n }, (_, i) => {
        const v = byIndex.get(i);
        return v && v.inEnvelope === false ? { inEnvelope: false, reason: v.reason } : { inEnvelope: true, reason: v?.reason ?? "normal" };
      });
    };

    return {
      env: { motorized: pick(data.motorized, scope.motorizedSets.length), blinds: pick(data.blinds, scope.blinds.length) },
      usage: addUsage(emptyUsage(), message),
    };
  } catch (e) {
    // The guard must never block a bid — on failure, treat everything as normal
    // (deterministic tiers price it, exactly as before Pillar 2).
    console.error("wt-envelope check failed — treating all as in-envelope", { error: (e as Error)?.message });
    return { env: { motorized: allOk(scope.motorizedSets.length), blinds: allOk(scope.blinds.length) }, usage: emptyUsage() };
  }
}
