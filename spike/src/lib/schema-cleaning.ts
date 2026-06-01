import { z } from "zod";

/**
 * The CLEANING vertical's extraction schema — deliberately different from the
 * window-treatments schema. Scope here is area/count-derived, not tagged items.
 * This is the concrete proof that the extraction schema is PER-VERTICAL
 * (declared by the config), not one universal shape.
 */

const Cite = z.object({
  sheet: z.string().nullable(),
  page: z.number().int().nullable(),
});

export const AreaByLevel = z.object({
  level: z.string().describe("e.g. Cellar, First Floor, Second Floor, Attic, Garage, Deck"),
  sqft: z.number().nullable(),
  type: z.enum(["finished", "garage", "unfinished", "exterior", "other"]),
  cleanable: z.boolean().describe("Does this area get cleaned in scope (exterior decks/unfinished may not)?"),
  citation: Cite,
  confidence: z.number().min(0).max(1),
});

export const CleaningExtraction = z.object({
  tradeRelevance: z.object({
    bid: z.boolean(),
    confidence: z.number().min(0).max(1),
    reasoning: z.string(),
  }),
  project: z.object({
    name: z.string().nullable(),
    address: z.string().nullable(),
    buildingType: z.string().nullable().describe("e.g. single-family residence, commercial fit-out"),
    work: z.enum(["new-construction", "renovation", "addition", "mixed", "unknown"]),
  }),
  areas: z.array(AreaByLevel),
  totals: z.object({
    cleanableSqft: z.number().nullable().describe("Sum of cleanable area"),
    newConstructionSqft: z.number().nullable(),
    levels: z.number().int().nullable(),
  }),
  rooms: z.object({
    bedrooms: z.number().int().nullable(),
    bathrooms: z.number().int().nullable(),
    powderRooms: z.number().int().nullable(),
    kitchens: z.number().int().nullable(),
  }),
  windows: z.object({ count: z.number().int().nullable(), confidence: z.number().min(0).max(1), citation: Cite }),
  debris: z.object({
    newConstructionVolumeCF: z.number().nullable().describe("Cubic feet of new work if stated"),
    disturbedAreaSqft: z.number().nullable(),
    note: z.string().nullable(),
  }),
  applicableServices: z.array(z.string()).describe("Which of the trade's services apply to this project"),
  contacts: z.array(z.object({ name: z.string(), role: z.string(), company: z.string().nullable(), email: z.string().nullable() })),
  evidenceFound: z.array(z.object({ key: z.string(), present: z.boolean() })),
  assumptions: z.array(z.string()).describe("Anything inferred rather than stated — surfaced for contractor confirmation."),
});

export type CleaningExtraction = z.infer<typeof CleaningExtraction>;
export { z };
