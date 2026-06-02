import { z } from "zod";

/**
 * Per-vertical extraction shape for WINDOW TREATMENTS. Validated against a real
 * 100+pp bid set in the spike (see spike/FINDINGS.md) — this is the basis for the
 * `extractions.result` JSONB. Every extracted fact carries a confidence + citation;
 * the model may return null + a reason rather than hallucinate a value.
 */

export const Citation = z.object({
  sheet: z.string().nullable().describe("Drawing sheet or spec section number, e.g. 'A-601' or '12 24 00'"),
  page: z.number().int().nullable().describe("1-based page number in the uploaded package"),
  note: z.string().nullable().describe("Short quote or location of the evidence"),
});

const Confident = <T extends z.ZodTypeAny>(value: T) =>
  z.object({
    value: value.nullable(),
    confidence: z.number().min(0).max(1),
    citation: Citation,
    reason: z.string().nullable().describe("If null/uncertain, why."),
  });

export const ShadeType = z.object({
  code: z.string().describe("Type tag from the documents, e.g. 'WT1', 'MB1', 'FPS1'"),
  productType: z.enum(["WT", "MS", "FPS", "MB", "DR", "OTHER"]),
  productName: z.string(),
  motor: z.string().nullable(),
  control: z.string().nullable(),
  fabric: z.string().nullable(),
  openness: z.string().nullable(),
  color: z.string().nullable(),
  fascia: z.string().nullable(),
  citation: Citation,
  confidence: z.number().min(0).max(1),
});

export const ScopeItem = z.object({
  typeCode: z.string().describe("References a ShadeType.code"),
  qty: z.number().int().nullable().describe("Null if a treatment is clearly present but the count cannot be determined — that is a gap, not a guess."),
  width: z.string().nullable(),
  height: z.string().nullable(),
  shadesPerMotor: z.number().int().nullable().describe("Ganging — how many shades share one motor; drives pricing"),
  citation: Citation,
  confidence: z.number().min(0).max(1),
});

export const Location = z.object({
  floor: z.string().nullable(),
  room: z.string().nullable(),
  items: z.array(ScopeItem),
});

export const Contact = z.object({
  name: z.string(),
  role: z.enum(["GC", "Architect", "Owner", "Designer", "Engineer", "Other"]),
  company: z.string().nullable(),
  email: z.string().nullable().describe("Null if not found. A contact with no email is excluded downstream."),
  source: z.string().describe("Where found, e.g. 'title block A-000', 'spec cover'"),
  citation: Citation,
});

export const EvidenceFound = z.object({
  key: z.string().describe("Matches a requiredEvidence key from the vertical config"),
  present: z.boolean(),
  citation: Citation,
});

export const ExtractionResult = z.object({
  tradeRelevance: z.object({
    bid: z.boolean(),
    confidence: z.number().min(0).max(1),
    reasoning: z.string(),
  }),
  project: z.object({
    name: Confident(z.string()),
    address: Confident(z.string()),
    bidDueDate: Confident(z.string()),
  }),
  shadeTypes: z.array(ShadeType),
  locations: z.array(Location),
  unitTotals: z.object({
    byProductType: z.record(z.string(), z.number().int()).describe("e.g. { WT: 11, MB: 12, FPS: 2 }"),
    totalUnits: z.number().int(),
  }),
  contacts: z.array(Contact),
  evidenceFound: z.array(EvidenceFound),
  referencedSheets: z.array(z.string()).describe("Sheets/specs the documents point to (for reference-chasing), e.g. 'see A-601'"),
});

export type ExtractionResult = z.infer<typeof ExtractionResult>;
