import { MODELS, addUsage, pdfBlock, structuredCall, type Usage } from "../lib/anthropic.js";
import type { Scope } from "./price.js";

const TOOL = {
  type: "object",
  additionalProperties: false,
  properties: {
    motorizedSets: {
      type: "array",
      description: "One entry per WT1 motor-set tag. shadesPerMotor = how many shades share that one motor (1, 2, or 3), read from the plan/legend/notes.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          shadesPerMotor: { type: "integer" },
          location: { type: "string" },
          confidence: { type: "number" },
          citation: { type: "string" },
        },
        required: ["shadesPerMotor", "location", "confidence", "citation"],
      },
    },
    blinds: {
      type: "array",
      description: "One entry per MB1 mini-blind. widthInches read from the window dimension callout (e.g. 2'-6\"W → 30); null if not legible.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          widthInches: { type: ["number", "null"] },
          location: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["widthInches", "location", "confidence"],
      },
    },
    fixedPanels: { type: "integer", description: "Count of FPS1 fixed panel shades." },
  },
  required: ["motorizedSets", "blinds", "fixedPanels"],
};

const system =
  "You assemble a PRICEABLE window-treatment scope from the window-treatment plan (A-402) and its legend/notes. " +
  "WT1 = motorized roller shade; each WT1 tag is ONE motor SET — determine how many shades share that motor (ganging: 1, 2, or 3). " +
  "MB1 = manual aluminum mini-blind, priced by width — report each with its window width in inches from the dimension callouts. " +
  "FPS1 = fixed panel shade — report the count. " +
  "Read carefully; if a ganging or width isn't legible, give your best estimate with low confidence rather than omitting the item.";

export async function assemble(
  pageBase64: string,
  counts: { WT: number; MB: number; FPS: number }
): Promise<{ scope: Scope; usage: Usage }> {
  const { data, message } = await structuredCall({
    model: MODELS.extract,
    system,
    content: [
      pdfBlock(pageBase64),
      {
        type: "text",
        text:
          `An independent tiled count found ≈ ${counts.WT} WT1 motor-set tags, ${counts.MB} MB1 blinds, ${counts.FPS} FPS1 panels. ` +
          `Use as a cross-check. Return one motorizedSet per WT1 tag (with shadesPerMotor), one blind per MB1 (with widthInches), and the FPS1 count.`,
      },
    ],
    toolName: "assemble_scope",
    toolDescription: "Return the priceable scope: motorized sets with ganging, blinds with widths, fixed-panel count.",
    inputSchema: TOOL,
    maxTokens: 4000,
  });
  return { scope: data as Scope, usage: addUsage({ input: 0, output: 0 }, message) };
}
