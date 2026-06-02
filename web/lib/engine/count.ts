import { z } from "zod";
import { renderPage, tilePage } from "./render";
import { MODELS, addUsage, emptyUsage, imageBlock, structuredCall, type Usage } from "./anthropic";

export interface Detection {
  typeCode: string;
  label: string;
  ax: number; // absolute page-image coords (px)
  ay: number;
  confidence: number;
}

export interface PageCount {
  pageIndex: number;
  tilesTotal: number;
  tilesCounted: number; // after blank filter
  byType: Record<string, number>;
  detections: Detection[];
}

const CountResult = z.object({
  detections: z
    .array(
      z.object({
        typeCode: z.string().describe("The tag text, normalized, e.g. 'WT1', 'MB1', 'FPS1'. Use 'OTHER' if it's a window-treatment tag of an unlisted type."),
        label: z.string().describe("The exact text on the tag as drawn."),
        xPct: z.number().describe("Tag center X as a fraction (0..1) of THIS tile's width."),
        yPct: z.number().describe("Tag center Y as a fraction (0..1) of THIS tile's height."),
        confidence: z.number(),
      }),
    )
    .describe("One entry per window-treatment CALLOUT TAG placed at a window/opening. Do NOT count legend rows, title-block text, dimensions, or door/room tags."),
});

const system = (codes: string[]) =>
  `You are a quantity-takeoff vision step. You see ONE tile cropped from a high-DPI architectural floor/ceiling plan. ` +
  `Count window-treatment callout tags. Known type codes on this project: ${codes.join(", ")} (also accept WT-1 style variants). ` +
  `A tag is a small leader/bubble label placed AT a window or opening indicating its treatment type. ` +
  `Count every distinct tag instance you can see, even if small. Report each tag's center as a fraction of this tile. ` +
  `Exclude: the legend/schedule table, title block, dimension strings, door tags, room names. If the tile has no window-treatment tags, return an empty list.`;

/** Merge detections of the same type whose centers fall within `d` px — the same
 *  tag seen twice in an overlap band. */
function dedupe(dets: Detection[], d = 90): Detection[] {
  const out: Detection[] = [];
  for (const det of dets.sort((a, b) => b.confidence - a.confidence)) {
    const dup = out.find((o) => o.typeCode === det.typeCode && Math.hypot(o.ax - det.ax, o.ay - det.ay) < d);
    if (!dup) out.push(det);
  }
  return out;
}

export async function countPage(
  pdfBytes: Uint8Array,
  pageIndex: number,
  typeCodes: string[],
  opts: { dpi?: number; inkThreshold?: number } = {},
): Promise<{ page: PageCount; usage: Usage }> {
  const dpi = opts.dpi ?? 200;
  const inkThreshold = opts.inkThreshold ?? 4;

  const rp = renderPage(pdfBytes, pageIndex, dpi);
  const tiles = await tilePage(rp);
  const busy = tiles.filter((t) => t.ink >= inkThreshold);

  let usage = emptyUsage();
  const raw: Detection[] = [];

  for (const tile of busy) {
    const { data, message } = await structuredCall({
      model: MODELS.count,
      system: system(typeCodes),
      content: [imageBlock(tile.base64), { type: "text", text: `Tile at page-offset (${tile.ox},${tile.oy}), ${tile.w}x${tile.h}px. Count window-treatment tags.` }],
      toolName: "report_tags",
      toolDescription: "Report window-treatment callout tags visible in this tile.",
      schema: CountResult,
      maxTokens: 2000,
    });
    usage = addUsage(usage, message);
    for (const det of data.detections ?? []) {
      raw.push({
        typeCode: det.typeCode.toUpperCase().replace(/[\s-]/g, ""),
        label: det.label,
        ax: tile.ox + det.xPct * tile.w,
        ay: tile.oy + det.yPct * tile.h,
        confidence: det.confidence,
      });
    }
  }

  const deduped = dedupe(raw);
  const byType: Record<string, number> = {};
  for (const det of deduped) byType[det.typeCode] = (byType[det.typeCode] ?? 0) + 1;

  return { page: { pageIndex, tilesTotal: tiles.length, tilesCounted: busy.length, byType, detections: deduped }, usage };
}
