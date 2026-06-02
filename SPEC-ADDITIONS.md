# BidWork — Spec Additions

Product/spec additions discovered **during** the build that aren't in the original
`spec.html` / mockups / `BUILD-PLAN.md`. Captured here as we go and **handled at the
end** (or folded into the relevant stage when convenient). Each entry: the problem,
the proposed behavior, where it touches, and any open decision.

Status legend: 🟡 proposed · 🔵 accepted (build pending) · ✅ done

---

## 1 · "Request a site visit" proposal for unquantifiable scope  🔵

**Discovered:** Stage 2 testing, ABH (16 Chapin Rd) package — 2026-06-03.

**Problem.** When a trade scores **bid** but the package only *names* the scope
without quantifying it (e.g. ABH's keynote "PROVIDE NEW CORDLESS WINDOW TREATMENTS AT
ALL WINDOW LOCATIONS" — no shade schedule, no tag-bearing plan), the engine correctly
counts **0 units** and `priceScope` returns just the install-fee floor (~$1,824). That
reads like a real quote but isn't — there's nothing priceable yet.

**Proposed behavior.** Don't fabricate a floor price and don't go silent. Produce a
distinct **site-visit / field-measure proposal**: the contractor still gets in the
door with the GC, with no invented number — *"We've reviewed the scope and want to
field-measure to give you an accurate quote."* Consistent with the existing "a no-bid
is never a dead end" principle.

**Touch points.**
- `engine.extract-bid` — if extracted scope has **0 quantifiable units** but the trade
  scored bid, create the bid as **`kind = 'site_visit'`** with **no total** + a note,
  instead of the install-only floor.
- Schema — add `bids.kind text not null default 'priced'` (migration).
- Admin Review & Dispatch — show **"Site visit — quote on measure"** instead of a $
  amount for that contractor row (still dispatchable).
- Contractor bid page (`/app/bids/[id]`) — render a **visit-request variant** (scope
  summary + "request a site visit" framing instead of line items); **Approve & send**
  emails the GC a measure request (reply-to = contractor).

**Open decision.** Trigger on **strictly zero units**, or also when a priced total
falls **below the onboarding minimum job charge**? (Below-min could also route to
"site visit / not worth a remote quote".)
