import { readFile } from "node:fs/promises";
import * as mupdf from "mupdf";
import sharp from "sharp";

export interface Tile {
  /** base64 PNG of this tile, at full detail. */
  base64: string;
  /** tile origin in the full rendered page image (pixels). */
  ox: number;
  oy: number;
  w: number;
  h: number;
  /** max per-channel std-dev; ~0 for a blank white tile, higher where there's ink. */
  ink: number;
}

export interface RenderedPage {
  pageIndex: number; // 0-based
  dpi: number;
  width: number; // full page image, px
  height: number;
  png: Buffer; // full page render (kept for debugging)
}

/** Render one PDF page to a PNG at the given DPI (MuPDF, pure WASM). */
export async function renderPage(pdfPath: string, pageIndex: number, dpi = 200): Promise<RenderedPage> {
  const buf = await readFile(pdfPath);
  const doc = mupdf.Document.openDocument(new Uint8Array(buf), "application/pdf");
  const page = doc.loadPage(pageIndex);
  const zoom = dpi / 72;
  const matrix = mupdf.Matrix.scale(zoom, zoom);
  const pix = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false);
  const png = Buffer.from(pix.asPNG());
  const width = pix.getWidth();
  const height = pix.getHeight();
  pix.destroy?.();
  page.destroy?.();
  doc.destroy?.();
  return { pageIndex, dpi, width, height, png };
}

/**
 * Slice a rendered page into ~`target`-px tiles with `overlap`-px margins so a
 * tag straddling a seam is fully visible in at least one neighbour. Each tile is
 * already within the model's resolution sweet spot, so its detail is preserved.
 */
export async function tilePage(rp: RenderedPage, target = 1500, overlap = 120): Promise<Tile[]> {
  const step = target - overlap;
  const cols = Math.max(1, Math.ceil((rp.width - overlap) / step));
  const rows = Math.max(1, Math.ceil((rp.height - overlap) / step));
  const tiles: Tile[] = [];
  const base = sharp(rp.png);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ox = c * step;
      const oy = r * step;
      const w = Math.min(target, rp.width - ox);
      const h = Math.min(target, rp.height - oy);
      if (w <= 0 || h <= 0) continue;
      const region = base.clone().extract({ left: ox, top: oy, width: w, height: h });
      const stats = await region.clone().stats();
      const ink = Math.max(...stats.channels.map((c) => c.stdev));
      const png = await region.png().toBuffer();
      tiles.push({ base64: png.toString("base64"), ox, oy, w, h, ink });
    }
  }
  return tiles;
}
