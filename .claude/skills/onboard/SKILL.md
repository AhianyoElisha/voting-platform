---
name: onboard
description: Read every project doc and give a grounded briefing on the voting platform — what it is, what's decided, what's open, what's built, and the sensible next step. Run at the start of a session or after a long break.
---

# /onboard

Build a complete picture of the project before any work starts.

## Steps

1. Read, in this order: `CLAUDE.md`, `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/FLYER_ENGINE.md`, `docs/USSD_AND_PAYMENTS.md`, `docs/COMPETITIVE_ANALYSIS.md`, `docs/DECISIONS.md`, `docs/OPEN_QUESTIONS.md`, and anything in `docs/sources/`.
2. Look at the codebase as it stands: `package.json` (if present), the top-level folder layout, `appwrite.config.json` and the `functions/` directory (if present), and any `README`. Don't read every source file; sample enough to say what exists.
3. Compare docs to code. Note anything built that the docs don't describe, and anything the docs describe that isn't built.

## Output

A briefing in this shape, kept tight:

- **What this is** — two or three sentences in plain words.
- **Non-negotiables** — the rules in `CLAUDE.md` that constrain every change (paid votes only from confirmed payments, tenant isolation, idempotent callbacks, pesewas, rounds, audited free votes).
- **Decided** — the key entries from `DECISIONS.md`, one line each.
- **Open** — the questions from `OPEN_QUESTIONS.md` that block the most work, with the numbers. Call out #29 (morale candidates) and whichever ones block scaffolding.
- **Built so far** — honest state of the code. "Nothing yet" is a fine answer.
- **Drift** — any doc/code mismatches found in step 3.
- **Suggested next step** — one concrete thing, and which open questions it depends on.

Don't propose answers to open questions here. That's what `/decide` is for.
