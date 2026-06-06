import { z } from "zod";
import { Contact } from "./extract";

/**
 * Per-vertical extraction shape for WINDOW TREATMENTS, rebuilt to MIRROR the flooring
 * schema (systems + items) so WT reuses the shared match + price engine. The old
 * shape (shadeTypes/locations + a WT1/MB1/FPS1 tile-count) only worked on packages
 * using that exact tag vocabulary; this one reads ANY shade SCHEDULE.
 *
 * Shape discipline (same as flooring): top-level fields are SCALARS or ARRAYS only
 * (the model mangles top-level object props) — relevance/project are flattened.
 *
 * WT is AREA-priced like flooring: each scheduled opening's shade area (W×H×qty)
 * is the priceable quantity, matched to the contractor's per-SF shade products.
 * Width/height/qty are reported ONLY when stated — a present-but-unsized shade
 * becomes a field-measure gap downstream, never a guessed number.
 */

const ShadeSystem = z.object({
  code: z.string().describe("Type tag from the documents if any, e.g. 'Shade Type 1', 'WT1', 'SHD', 'RS-1' (else a short name)"),
  name: z.string().describe("Shade product as written/understood, e.g. 'Motorized solar roller shade', 'Manual room-darkening dual shade', 'Manual aluminum mini-blind'"),
  control: z.enum(["manual", "motorized", "unknown"]).describe("Operation: manually operated or motor operated"),
  fabric: z.string().nullable().describe("Fabric/light character: 'solar screen', 'room-darkening/blackout', 'dual (solar + blackout)', 'multi-band'; null if not stated"),
  spec: z.string().nullable().describe("Other build detail: openness %, color, fascia/pocket, basis-of-design manufacturer"),
  citation: z.string().nullable().describe("Sheet/page + note where found, e.g. '12 24 13 spec / A-402 shade schedule'"),
  confidence: z.number().min(0).max(1),
});

const ShadeItem = z.object({
  level: z.string().nullable(),
  room: z.string().nullable().describe("Room name/number the schedule assigns this shade to"),
  system: z.string().describe("References a ShadeSystem.name/code — which shade product this opening gets"),
  widthInches: z.number().nullable().describe("Shade/opening WIDTH in inches. Convert callouts (2'-6\" → 30). NULL if not stated — that opening becomes a field-measure gap, never a guess."),
  heightInches: z.number().nullable().describe("Shade/opening HEIGHT in inches. NULL if not stated."),
  qty: z.number().int().nullable().describe("How many shades of this product at this location. NULL if clearly present but the count cannot be determined — a gap, not a guess."),
  citation: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

export const WtExtractionResult = z.object({
  // Relevance (flattened scalars).
  bid: z.boolean(),
  bidConfidence: z.number().min(0).max(1),
  bidReasoning: z.string(),
  // Project (flattened scalars).
  projectName: z.string().nullable(),
  projectAddress: z.string().nullable(),
  bidDueDate: z.string().nullable().describe("Bid due/closing date if stated; null otherwise"),
  // Scope.
  systems: z.array(ShadeSystem).describe("Distinct shade products in this trade's scope"),
  items: z.array(ShadeItem).describe("One entry per scheduled opening/run that receives a shade (room × product × size × qty)"),
  // Shared.
  contacts: z.array(Contact),
  evidenceFound: z.array(z.object({ key: z.string().describe("Matches a requiredEvidence key"), present: z.boolean() })),
  referencedSheets: z.array(z.string()).describe("Sheets/specs the documents point to but may be absent, e.g. 'A-601'"),
});

export type WtExtractionResult = z.infer<typeof WtExtractionResult>;
