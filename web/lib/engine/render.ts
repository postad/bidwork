import * as mupdf from "mupdf";
import sharp from "sharp";

export interface Tile {
  base64: string; // full-detail PNG of this tile
  ox: number; // origin in the full page image (px)
  oy: number;
  w: number;
  h: number;
  ink: number; // max per-channel std-dev; ~0 for blank white tiles
}

export interface RenderedPage {
  pageIndex: number;
  dpi: number;
  width: number;
  height: number;
  png: Buffer;
}

/** Render one PDF page (from bytes) to a PNG at the given DPI (MuPDF, pure WASM). */
export function renderPage(pdfBytes: Uint8Array, pageIndex: number, dpi = 200): RenderedPage {
  const doc = mupdf.Document.openDocument(pdfBytes, "application/pdf");
  const page = doc.loadPage(pageIndex);
  const zoom = dpi / 72;
  const pix = page.toPixmap(mupdf.Matrix.scale(zoom, zoom), mupdf.ColorSpace.DeviceRGB, false);
  const png = Buffer.from(pix.asPNG());
  const width = pix.getWidth();
  const height = pix.getHeight();
  pix.destroy?.();
  page.destroy?.();
  doc.destroy?.();
  return { pageIndex, dpi, width, height, png };
}

/**
 * Slice a rendered page into ~`target`-px tiles with `overlap`-px margins, so a
 * tag straddling a seam is fully visible in a neighbour. Each tile is already
 * within the model's resolution sweet spot, preserving detail; `ink` lets the
 * caller skip near-blank tiles.
 */
export async function tilePage(rp: RenderedPage, target = 1500, overlap = 120): Promise<Tile[]> {
  const step = target - overlap;
  const cols = Math.max(1, Math.ceil((rp.width - overlap) / step));
  const rows = Math.max(1, Math.ceil((rp.height - overlap) / step));
  const base = sharp(rp.png);
  const tiles: Tile[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ox = c * step;
      const oy = r * step;
      const w = Math.min(target, rp.width - ox);
      const h = Math.min(target, rp.height - oy);
      if (w <= 0 || h <= 0) continue;
      const region = base.clone().extract({ left: ox, top: oy, width: w, height: h });
      const stats = await region.clone().stats();
      const ink = Math.max(...stats.channels.map((ch) => ch.stdev));
      const png = await region.png().toBuffer();
      tiles.push({ base64: png.toString("base64"), ox, oy, w, h, ink });
    }
  }
  return tiles;
}
