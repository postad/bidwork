# BidWork — Engine Spike

A standalone script (no app, no DB, no UI) that runs one real ITB through the
bid engine and writes its structured output to JSON. The point is to **discover
the real shape of the extraction on a real document** before we design the
database schema or build the app — reality shapes the schema, not the reverse.

## Pipeline

```
load PDF → chunk to ≤90p/≤28MB → triage (Haiku: which pages matter)
        → extract (Opus: structured scope + confidence + citations)
        → detect gaps (against the vertical's requiredEvidence checklist)
        → out/2160-sunrise.result.json
```

All structured model calls are **forced through a tool schema**, so the model
returns a validated object — never prose — and is explicitly allowed to emit
`null + reason` instead of hallucinating a value.

## Run it

```bash
cd spike
npm install
# key lives in ../.env  (ANTHROPIC_API_KEY=...)

npm run probe        # no API calls — just page count + chunking plan
npm run run          # full pipeline on 2160-Sunrise (the doc with ground truth)
npm run run -- "../Projects/SparkWellness-Verona-NJ/260514_SparkWellness_Issue for Permit and Bid.pdf"
```

Model overrides (optional, in `../.env`): `MODEL_TRIAGE`, `MODEL_EXTRACT`.

## Why 2160-Sunrise leads

It's the one project with a **matched submitted proposal** (`proposal view.pdf`,
Estimate #14473). `fixtures/2160-sunrise.groundtruth.json` captures what a
correct read must produce — WT1=11 motorized, MB1=12 blinds, FPS1=2 fixed,
priced by motor-set ganging. That makes the spike a real accuracy test, not a
vibe check.

## Files

- `config/window-treatments.json` — the VerticalConfig (the "add a trade = add a
  config" claim made concrete: products, router keywords, no-bid signals,
  requiredEvidence checklist, expected documents).
- `src/lib/schema.ts` — the extraction output shape (zod). **This is the draft
  of the real `extractions` JSONB + `bid_line_items`.**
- `src/lib/pdf.ts` — split a huge set into request-sized chunks; build subsets.
- `src/pipeline/{triage,extract,gaps}.ts` — the three engine steps.
- `src/run.ts` — orchestrator + ground-truth comparison.
