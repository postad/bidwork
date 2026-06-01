import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";

// Anthropic limits are really: 32 MB *request* (base64 inflates raw ~4/3) AND
// 200k *tokens* AND 100 pages. The token ceiling bites first on dense drawings,
// so we chunk small on pages and cap raw bytes well under the base64 ceiling;
// triage further splits any chunk that still overflows at call time.
const MAX_BYTES = 18 * 1024 * 1024; // raw → ~24 MB base64, safely < 32 MB request
const MAX_PAGES = 40;

export interface Chunk {
  /** 0-based page indices (into the original doc) contained in this chunk. */
  pageIndices: number[];
  /** base64 of a standalone PDF holding exactly those pages. */
  base64: string;
  bytes: number;
}

export async function loadDoc(path: string) {
  const bytes = await readFile(path);
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return { doc, pageCount: doc.getPageCount(), bytes: bytes.byteLength };
}

async function buildSubset(src: PDFDocument, indices: number[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, indices);
  pages.forEach((p) => out.addPage(p));
  return out.save();
}

/**
 * Split a (possibly huge) PDF into request-sized chunks. Pages first; if a
 * page-bounded chunk still exceeds the byte limit (dense scanned drawings), it
 * is halved recursively. Returns chunks covering the whole document in order.
 */
export async function chunkForApi(src: PDFDocument): Promise<Chunk[]> {
  const total = src.getPageCount();
  const ranges: number[][] = [];
  for (let i = 0; i < total; i += MAX_PAGES) {
    ranges.push(Array.from({ length: Math.min(MAX_PAGES, total - i) }, (_, k) => i + k));
  }

  const chunks: Chunk[] = [];
  const emit = async (indices: number[]): Promise<void> => {
    const bytes = await buildSubset(src, indices);
    if (bytes.byteLength > MAX_BYTES && indices.length > 1) {
      const mid = Math.ceil(indices.length / 2);
      await emit(indices.slice(0, mid));
      await emit(indices.slice(mid));
      return;
    }
    chunks.push({
      pageIndices: indices,
      base64: Buffer.from(bytes).toString("base64"),
      bytes: bytes.byteLength,
    });
  };

  for (const r of ranges) await emit(r);
  return chunks;
}

/** Build one standalone PDF (base64) from arbitrary 0-based page indices. */
export async function subsetBase64(src: PDFDocument, indices: number[]): Promise<string> {
  const bytes = await buildSubset(src, indices);
  return Buffer.from(bytes).toString("base64");
}
