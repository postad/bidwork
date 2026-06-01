import { fileURLToPath } from "node:url";
import { dirname, resolve, basename } from "node:path";
import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
dotenv.config({ path: resolve(ROOT, ".env") });

import { loadDoc } from "./lib/pdf.js";
import { triage } from "./pipeline/triage.js";

const PROJECTS = resolve(ROOT, "Projects");
const CAP_MB = Number(process.argv[process.argv.indexOf("--cap") + 1]) || 60;

// Pick the architectural drawing set for a project — that's where window-treatment
// scope lives. Strongly prefer ARCH; penalize MEP/fixture/spec/addendum noise.
function score(f: string): number {
  let s = 0;
  if (/\barch\b|architect/i.test(f)) s += 4;
  if (/drawing/i.test(f)) s += 2;
  if (/bid set|bidset|permit|combined|full set/i.test(f)) s += 1;
  if (/meps?\b|mechanical|plumb|hvac|electric|\bfa\d|\bfp\b|fire|fixture|appliance|toilet|lighting/i.test(f)) s -= 5;
  if (/spec|addend|proposal|manual|\blog\b/i.test(f)) s -= 4;
  return s;
}

async function pickFile(dir: string): Promise<{ path: string; mb: number; note?: string } | null> {
  const files = (await readdir(dir)).filter((f) => f.toLowerCase().endsWith(".pdf"));
  const withSize = await Promise.all(files.map(async (f) => ({ f, mb: (await stat(resolve(dir, f))).size / 1048576 })));
  const ok = withSize.filter((x) => x.mb <= CAP_MB);
  if (!ok.length) return null;
  // Highest score wins; tiebreak toward the LARGER file — a full "Merged Drawing"
  // set beats a partial "Drawings" stub (MEP noise is already score-penalized).
  const ranked = ok.sort((a, b) => score(b.f) - score(a.f) || b.mb - a.mb);
  const chosen = ranked[0];
  const best = Math.max(...withSize.map((x) => x.mb));
  const note = best > CAP_MB ? `larger set (${best.toFixed(0)}MB) skipped by cap` : undefined;
  return { path: resolve(dir, chosen.f), mb: chosen.mb, note };
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) { console.error("\n❌ ANTHROPIC_API_KEY not set.\n"); process.exit(1); }
  const cfg = JSON.parse(await readFile(resolve(__dirname, "../config/window-treatments.json"), "utf8"));

  const dirs = (await readdir(PROJECTS, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  const skip = process.argv.includes("--skip-2160");
  const rows: any[] = [];

  for (const name of dirs) {
    if (skip && name.startsWith("2160")) continue;
    const dir = resolve(PROJECTS, name);
    const pick = await pickFile(dir);
    if (!pick) { console.log(`\n⏭️  ${name}: no PDF ≤ ${CAP_MB}MB (large set — needs production streaming split)`); rows.push({ name, status: "skipped-too-large" }); continue; }

    console.log(`\n📂 ${name}\n   file: ${basename(pick.path)} (${pick.mb.toFixed(1)} MB)${pick.note ? ` · ${pick.note}` : ""}`);
    try {
      const { doc, pageCount } = await loadDoc(pick.path);
      const t = await triage(doc, cfg.router.keywords);
      const kinds = [...new Set(t.details.map((d) => d.kind))];
      const row = { name, file: basename(pick.path), mb: +pick.mb.toFixed(1), pages: pageCount, scope: t.anyScope, relevantPages: t.relevantPages.map((p) => p + 1), kinds, tokens: t.usage };
      rows.push(row);
      console.log(`   → ${pageCount}p · scope: ${t.anyScope ? "BID (window-treatment scope found)" : "NO-BID (no scope)"} · ${t.relevantPages.length} relevant page(s) [${kinds.join(", ")}]`);
    } catch (e: any) {
      console.log(`   ❌ error: ${e.message}`);
      rows.push({ name, file: basename(pick.path), status: "error", error: e.message });
    }
  }

  console.log(`\n════════════ SWEEP SUMMARY ════════════`);
  for (const r of rows) {
    if (r.status) { console.log(`  ${r.name.padEnd(38)} ${r.status}`); continue; }
    console.log(`  ${r.name.padEnd(38)} ${r.scope ? "BID    " : "NO-BID "} ${String(r.pages).padStart(3)}p  rel:${r.relevantPages.length}  [${r.kinds.join(",")}]`);
  }

  await mkdir(resolve(__dirname, "../out"), { recursive: true });
  await writeFile(resolve(__dirname, "../out/batch-triage.json"), JSON.stringify(rows, null, 2));
  console.log(`\n💾 out/batch-triage.json\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
