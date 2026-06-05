import * as mupdf from "mupdf";

/**
 * Page-level triage for the SPEC book — the cost elephant. A PlanHub spec is 2,000+
 * pages organized by CSI division, but a contractor only needs the divisions their
 * trades cover (flooring → 09, window treatments → 12, HVAC → 23…). We read each
 * page's CSI section number (real text, deterministic — NO AI, NO vision) and keep
 * only pages whose division is in the active-trade set, so the expensive Sonnet scan
 * reads ~10% of the spec instead of all of it.
 *
 * SAFE BY DESIGN — conservative: a page is KEPT when its section's division matches
 * OR when no clear section number is found (cover/TOC/dividers, or a page whose text
 * didn't extract). We only DROP a page we're confident belongs to another division.
 */

const SECTION_RE = /\b(\d{2})\s?(\d{2})\s?(\d{2})\b/; // CSI section like "09 65 00"

/** The 2-digit CSI divisions the active trades care about — derived from each trade's
 *  vertical_config (router.csiSections + any CSI numbers embedded in router.keywords),
 *  so the keep-set tracks the live catalog (add HVAC → div 23 joins automatically). */
export function activeDivisions(configs: { router?: { csiSections?: string[]; keywords?: string[] } }[]): Set<string> {
  const divs = new Set<string>();
  for (const c of configs) {
    for (const s of [...(c.router?.csiSections ?? []), ...(c.router?.keywords ?? [])]) {
      const m = SECTION_RE.exec(String(s));
      if (m) divs.add(m[1]);
    }
  }
  return divs;
}

/**
 * Return the 0-based page indices of a spec book worth scanning for the given CSI
 * divisions. If no divisions are known (can't tell what's relevant) → keep ALL pages
 * (never silently gut the spec). Reads text via MuPDF; never renders.
 */
export function selectSpecPages(bytes: Uint8Array, divisions: Set<string>): number[] {
  const doc = mupdf.Document.openDocument(bytes, "application/pdf");
  try {
    const n = doc.countPages();
    if (!divisions.size) return Array.from({ length: n }, (_, i) => i);

    const kept: number[] = [];
    for (let i = 0; i < n; i++) {
      let text = "";
      try {
        const page = doc.loadPage(i);
        text = page.toStructuredText("preserve-whitespace").asText() ?? "";
        page.destroy?.();
      } catch {
        // Extraction failed for this page → keep it (conservative).
      }
      // Section number lives in the page header/footer.
      const zone = text.slice(0, 350) + " " + text.slice(-350);
      const m = SECTION_RE.exec(zone);
      if (!m || divisions.has(m[1])) kept.push(i); // matched division, OR no clear section → keep
    }
    return kept;
  } finally {
    doc.destroy?.();
  }
}
