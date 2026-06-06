import { z } from "zod";

/**
 * Per-vertical extraction shape for WINDOW TREATMENTS → the basis for the
 * `extractions.result` JSONB.
 *
 * IMPORTANT shape constraint: the model reliably fills tool inputs whose top-level
 * fields are SCALARS or ARRAYS, but mangles top-level OBJECT properties into the
 * text tool-call format (`<parameter name=...>`), corrupting them. So relevance
 * and project are flattened to scalars, unitTotals is an array, and citations are
 * strings rather than nested objects. (The priceable Scope comes from `assemble`.)
 */

const PRODUCT_TYPE = z.enum(["WT", "MS", "FPS", "MB", "DR", "OTHER"]);
const CONTACT_ROLE = z.enum(["GC", "Architect", "Owner", "Designer", "Engineer", "Other"]);

export const ShadeType = z.object({
  code: z.string().describe("Type tag from the documents, e.g. 'WT1', 'MB1', 'FPS1'"),
  productType: PRODUCT_TYPE,
  productName: z.string(),
  motor: z.string().nullable(),
  control: z.string().nullable(),
  fabric: z.string().nullable(),
  openness: z.string().nullable(),
  color: z.string().nullable(),
  fascia: z.string().nullable(),
  citation: z.string().nullable().describe("Sheet/page + short note where found, e.g. 'A-402 p3: WT1 legend'"),
  confidence: z.number().min(0).max(1),
});

export const ScopeItem = z.object({
  typeCode: z.string().describe("References a ShadeType.code"),
  qty: z.number().int().nullable().describe("Null if a treatment is clearly present but the count cannot be determined — that is a gap, not a guess."),
  width: z.string().nullable(),
  height: z.string().nullable(),
  shadesPerMotor: z.number().int().nullable().describe("Ganging — how many shades share one motor; drives pricing"),
  citation: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

export const Location = z.object({
  floor: z.string().nullable(),
  room: z.string().nullable(),
  items: z.array(ScopeItem),
});

export const Contact = z.object({
  name: z.string(),
  role: CONTACT_ROLE,
  company: z.string().nullable(),
  email: z.string().nullable().describe("The contact's email address EXACTLY as printed (e.g. 'jt@taylorarchitects.com', 'info@firm.com'). Look hard: title blocks and project-team lists often print it beside Tel/Voice/Fax, and firm blocks carry a general 'info@' address. If an email appears anywhere for this contact, put it HERE — never only in `source`. Null ONLY when no email is printed. A contact with no email is dropped downstream, so don't miss one that is there."),
  source: z.string().describe("Where found, e.g. 'title block A-000', 'spec cover'"),
});

export const ExtractionResult = z.object({
  // Relevance (flattened — see shape note above).
  bid: z.boolean(),
  bidConfidence: z.number().min(0).max(1),
  bidReasoning: z.string(),
  // Project (flattened scalars).
  projectName: z.string().nullable(),
  projectAddress: z.string().nullable(),
  bidDueDate: z.string().nullable().describe("Bid due/closing date if stated; null otherwise"),
  // Scope.
  shadeTypes: z.array(ShadeType),
  locations: z.array(Location),
  unitTotals: z.array(z.object({ code: z.string(), count: z.number().int() })).describe("e.g. [{code:'WT',count:11},{code:'MB',count:12},{code:'FPS',count:2}]"),
  totalUnits: z.number().int(),
  contacts: z.array(Contact),
  evidenceFound: z.array(z.object({ key: z.string().describe("Matches a requiredEvidence key"), present: z.boolean() })),
  referencedSheets: z.array(z.string()).describe("Sheets/specs the documents point to but may be absent, e.g. 'A-601'"),
});

export type ExtractionResult = z.infer<typeof ExtractionResult>;
