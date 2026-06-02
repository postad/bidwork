import type { ExtractionResult } from "./schemas/extract";

export interface Gap {
  kind: "required-but-empty" | "low-confidence" | "missing-document" | "referenced-not-present" | "no-bid";
  severity: "critical" | "warning";
  message: string;
  evidenceKey?: string;
}

interface VerticalConfig {
  requiredEvidence: { key: string; label: string; blocking: boolean }[];
}

const LOW_CONF = 0.6;

/**
 * Detect gaps RELATIVE TO THE VERTICAL'S EXPECTATIONS — you cannot detect an
 * absence in a vacuum. Mirrors the five detectors in the brief.
 */
export function detectGaps(result: ExtractionResult, cfg: VerticalConfig): Gap[] {
  const gaps: Gap[] = [];

  // 5 · No-bid gate
  if (!result.bid) {
    gaps.push({ kind: "no-bid", severity: "warning", message: `Scored no-bid: ${result.bidReasoning}` });
  }

  // 1 · Required-but-empty (measured against the requiredEvidence checklist)
  const found = new Map(result.evidenceFound.map((e) => [e.key, e.present]));
  for (const req of cfg.requiredEvidence ?? []) {
    const present = found.get(req.key);
    if (present !== true) {
      gaps.push({
        kind: "required-but-empty",
        severity: req.blocking ? "critical" : "warning",
        message: `Required evidence missing: ${req.label}`,
        evidenceKey: req.key,
      });
    }
  }

  // 2 · Low-confidence fields
  for (const t of result.shadeTypes) {
    if (t.confidence < LOW_CONF) gaps.push({ kind: "low-confidence", severity: "warning", message: `Low confidence on type ${t.code} (${t.confidence.toFixed(2)})` });
  }
  for (const loc of result.locations)
    for (const it of loc.items) {
      const where = `${loc.floor ?? "?"}/${loc.room ?? "?"}`;
      if (it.qty == null)
        gaps.push({ kind: "required-but-empty", severity: "warning", message: `Quantity not determined for ${it.typeCode} at ${where} — confirm count.` });
      else if (it.confidence < LOW_CONF)
        gaps.push({ kind: "low-confidence", severity: "warning", message: `Low confidence on ${it.qty}× ${it.typeCode} at ${where} (${it.confidence.toFixed(2)})` });
    }

  // 4 · Referenced-but-not-present (reference chasing — flagged for admin to confirm)
  for (const ref of result.referencedSheets) {
    gaps.push({ kind: "referenced-not-present", severity: "warning", message: `Document references "${ref}" — confirm it was in the package.` });
  }

  return gaps;
}
