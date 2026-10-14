---
name: feature
description: Plan a feature against the project docs before writing code — cite the PRD section, data model entities, rules from CLAUDE.md and any open questions that block it. Use before implementing anything non-trivial. Usage: /feature <short description>
---

# /feature

Turn a feature request into a plan that's grounded in the docs, then wait for approval before coding.

## Steps

1. Read `CLAUDE.md`, `docs/PRD.md`, `docs/DATA_MODEL.md`, `docs/OPEN_QUESTIONS.md` and `docs/DECISIONS.md`. Read `docs/USSD_AND_PAYMENTS.md` if the feature touches voting, payments, tickets or USSD. Read `docs/FLYER_ENGINE.md` if it touches templates, fonts or flyers.
2. Find where the feature lives in the PRD. If it isn't there, say so and ask whether to add it before continuing.
3. List the entities and fields in `DATA_MODEL.md` it touches. Note any new fields or tables needed and whether they're consistent with the existing model.
4. Check `OPEN_QUESTIONS.md`. If any open question blocks the feature, stop and list them. Offer to build behind a placeholder only if the developer agrees.
5. Check the working rules in `CLAUDE.md`. State which ones apply and how the plan respects them.
6. Write the plan.

## Output

- **PRD reference** — section number and a one-line quote or paraphrase.
- **Data model** — entities touched, new fields/tables, migration needed (yes/no).
- **Rules that apply** — e.g. "3: paid votes only from confirmed payment", "4: tenant scoping", "3b: rounds".
- **Blocked by** — open question numbers, or "none".
- **Plan** — ordered steps, each small enough to review. Include the tests from rule 9 where relevant.
- **Out of scope** — things the request might imply but the plan deliberately leaves out.

Then stop and ask for a go-ahead. Don't start coding in the same turn.
