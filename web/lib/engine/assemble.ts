import { z } from "zod";
import { MODELS, addUsage, emptyUsage, pdfBlock, structuredCall, type Usage } from "./anthropic";
import type { Scope } from "./price";

const AssembledScope = z.object({
  motorizedSets: z
    .array(
      z.object({
        shadesPerMotor: z.number().int(),
        location: z.string(),
        confidence: z.number(),
        citation: z.string(),
      }),
    )
    .describe("One entry per WT1 motor-set tag. shadesPerMotor = how many shades share that one motor (1, 2, or 3), read from the plan/legend/notes."),
  blinds: z
    .array(
      z.object({
        widthInches: z.number().nullable(),
        location: z.string(),
        confidence: z.number(),
      }),
    )
    .describe("One entry per MB1 mini-blind. widthInches from the window dimension callout (2'-6\"W → 30); null if not legible."),
  fixedPanels: z.number().int().describe("Count of FPS1 fixed panel shades."),
});

const system =
  "You assemble a PRICEABLE window-treatment scope from the window-treatment plan and its legend/notes. " +
  "WT1 = motorized roller shade; each WT1 tag is ONE motor SET — determine how many shades share that motor (ganging: 1, 2, or 3). " +
  "MB1 = manual aluminum mini-blind, priced by width — report each with its window width in inches from the dimension callouts. " +
  "FPS1 = fixed panel shade — report the count. " +
  "Read carefully; if a ganging or width isn't legible, give your best estimate with low confidence rather than omitting the item.";

export async function assemble(
  pageBase64: string,
  counts: { WT: number; MB: number; FPS: number },
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
    schema: AssembledScope,
    maxTokens: 4000,
  });
  return { scope: data as Scope, usage: addUsage(emptyUsage(), message) };
}
