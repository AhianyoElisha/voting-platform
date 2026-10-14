---
name: doc-check
description: Find drift between the docs and the code, stale TBDs, and cross-references that no longer resolve. Run after a chunk of implementation or before handing the project to someone else.
---

# /doc-check

The docs are meant to stay truthful as the code grows. This skill finds where they've slipped.

## Steps

1. Read every file in `docs/` and `CLAUDE.md`.
2. Read the schema (`appwrite.config.json` collections, or equivalent) and the top-level layout of `src/` (or wherever the code lives). Sample route handlers and services for the main flows: voting, payments, USSD, tickets, flyers, rounds.
3. Check each of these and collect findings:
   - **Model drift** — entities or fields in `DATA_MODEL.md` that aren't in the schema, and schema tables/fields that aren't documented.
   - **Feature drift** — PRD sections marked as core that have no code, and code for features the PRD doesn't mention.
   - **Stale TBDs** — "TBD", "proposed", "to be decided" in the docs where the code has clearly already made the choice (e.g. Appwrite collections exist but DATA_MODEL.md still calls an entity a draft). Each of these is a decision that was never recorded.
   - **Dangling references** — open question numbers cited in docs or code comments that are struck through or missing; `DECISIONS.md` rows that contradict current docs.
   - **CLAUDE.md commands** — the "Commands" section is empty or wrong relative to `package.json` scripts.
   - **Rule violations in plain sight** — anything obvious that contradicts the working rules (floats for money, unscoped queries), flagged for `/integrity-review` rather than fully reviewed here.

## Output

Group findings by the headings above. For each, give the file and a one-line fix. Where a stale TBD is really an unrecorded decision, say "run `/decide <n> ...`" with the decision you can infer from the code, but don't record it yourself.

Offer to apply the purely mechanical fixes (filling the Commands section, fixing dangling numbers) and wait for a yes.
