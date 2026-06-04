import { z } from "zod";
import { Contact } from "./extract";

/**
 * Per-vertical extraction shape for FLOORING (material-agnostic: epoxy, carpet,
 * resilient, polished/sealed concrete, wood, tile, …) → the basis for the
 * `extractions.result` JSONB. Mirrors the WT schema's shape discipline: top-level
 * fields are SCALARS or ARRAYS only (the model mangles top-level object props), so
 * relevance/project are flattened scalars and `prep` is flattened to prepType +
 * prepSqft rather than a nested object.
 *
 * Flooring is AREA-priced: the priceable scope is `areas` (room × system × SF).
 * SF is reported ONLY when the schedule/plan states it — a present-but-unquantified
 * floor becomes a site-visit bid downstream, never a guessed number.
 */

const FloorSystem = z.object({
  code: z.string().describe("Type/finish tag from the documents if any, e.g. 'F1', 'RF-1', 'PC1' (else a short name)"),
  name: z.string().describe("Floor system as written, e.g. 'Self-leveling epoxy', 'Carpet tile', 'Polished concrete L3'"),
  spec: z.string().nullable().describe("Build/spec detail: mils, grit/gloss, species/grade, thickness, color"),
  citation: z.string().nullable().describe("Sheet/page + note where found, e.g. 'A-601 finish schedule'"),
  confidence: z.number().min(0).max(1),
});

const FloorArea = z.object({
  level: z.string().nullable(),
  room: z.string().nullable().describe("Room name/number the finish schedule assigns this floor system to"),
  system: z.string().describe("References a FloorSystem.name/code — which system this room gets"),
  sqft: z.number().nullable().describe("Floor area in SF. NULL if the room gets this floor but no area is stated — that is a gap (→ site visit), never a guess."),
  citation: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

export const FlooringExtractionResult = z.object({
  // Relevance (flattened scalars).
  bid: z.boolean(),
  bidConfidence: z.number().min(0).max(1),
  bidReasoning: z.string(),
  // Project (flattened scalars).
  projectName: z.string().nullable(),
  projectAddress: z.string().nullable(),
  bidDueDate: z.string().nullable().describe("Bid due/closing date if stated; null otherwise"),
  // Scope.
  systems: z.array(FloorSystem).describe("Distinct floor systems in this trade's scope"),
  areas: z.array(FloorArea).describe("One entry per room that receives a floor system in this trade's scope"),
  baseTrimLf: z.number().nullable().describe("Total wall/cove base + transition strips in linear feet, if stated; else null"),
  prepType: z.string().nullable().describe("Substrate prep called for (shot-blast/grind/moisture mitigation/leveling), if any"),
  prepSqft: z.number().nullable().describe("Substrate-prep area in SF if separately scoped; else null"),
  // Shared.
  contacts: z.array(Contact),
  evidenceFound: z.array(z.object({ key: z.string().describe("Matches a requiredEvidence key"), present: z.boolean() })),
  referencedSheets: z.array(z.string()).describe("Sheets/specs the documents point to but may be absent, e.g. 'A-601'"),
});

export type FlooringExtractionResult = z.infer<typeof FlooringExtractionResult>;
