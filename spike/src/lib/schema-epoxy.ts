import { z } from "zod";

/**
 * Epoxy / resinous flooring extraction schema. The headline field is the
 * DISAMBIGUATION: "epoxy" in a bid set is usually anchors/adhesive, not floors.
 * The engine must say so explicitly rather than be fooled by keyword frequency.
 */

const Cite = z.object({ sheet: z.string().nullable(), page: z.number().int().nullable() });

export const EpoxyExtraction = z.object({
  tradeRelevance: z.object({
    bid: z.boolean(),
    confidence: z.number().min(0).max(1),
    reasoning: z.string(),
  }),
  disambiguation: z.object({
    epoxyFlooringScopePresent: z.boolean(),
    epoxyMentionsAreAnchorOrAdhesive: z.boolean().describe("True if the 'epoxy' references are Hilti-type anchors/adhesive or stair nose filler, NOT floor coating."),
    explanation: z.string(),
  }),
  floorFinishes: z.array(z.object({
    code: z.string().nullable().describe("e.g. F-1"),
    material: z.enum(["epoxy-resinous", "polished-concrete", "sealed-concrete", "resilient-vct-lvt", "rubber", "carpet", "wood", "tile", "other", "unknown"]),
    rooms: z.string().nullable(),
    citation: Cite,
  })).describe("All floor finishes found — the basis for deciding epoxy is or isn't in scope."),
  epoxyAreas: z.array(z.object({
    room: z.string().nullable(),
    sqft: z.number().nullable(),
    system: z.string().nullable(),
    confidence: z.number().min(0).max(1),
    citation: Cite,
  })).describe("Empty if no epoxy/resinous flooring is specified."),
  substrate: z.object({
    slabOnGradeSqft: z.number().nullable(),
    slabNotes: z.string().nullable(),
  }),
  totals: z.object({ epoxySqft: z.number().nullable() }),
  contacts: z.array(z.object({ name: z.string(), role: z.string(), company: z.string().nullable(), email: z.string().nullable() })),
  evidenceFound: z.array(z.object({ key: z.string(), present: z.boolean() })),
  missingDocuments: z.array(z.string()).describe("Expected docs not present (e.g. architectural finish schedule, Div 09 spec)."),
  assumptions: z.array(z.string()),
});

export type EpoxyExtraction = z.infer<typeof EpoxyExtraction>;
export { z };
