---
name: decide
description: Record a product or technical decision — move it from OPEN_QUESTIONS.md to DECISIONS.md with date and reasoning, and update every doc the decision affects. Usage: /decide <question number or topic> <the decision>
---

# /decide

Keep the docs the single source of truth when a question gets settled.

## Steps

1. Read `docs/OPEN_QUESTIONS.md` and `docs/DECISIONS.md`.
2. Identify which open question(s) the decision settles. If the developer gave a number, use it. If they described it, find the matching item and confirm you've got the right one.
3. If the decision is unclear or only partially settles the question, ask one focused question before writing anything.
4. Append a row to the table in `DECISIONS.md`: today's date (YYYY-MM-DD), the decision in one line, the reasoning in one line. Use the developer's own reasoning when they gave it; otherwise write "developer decision" rather than inventing a rationale.
5. In `OPEN_QUESTIONS.md`, strike the item through and add "Settled <date>. See DECISIONS." Keep the number so references elsewhere still resolve.
6. Search `CLAUDE.md` and every file in `docs/` for text that the decision changes — "TBD", "proposed", "open question", the old option names, cross-references by number — and update them. Common ones:
   - Stack decisions → `ARCHITECTURE.md` table and `CLAUDE.md` conventions
   - Nominee code scheme → `DATA_MODEL.md`, `USSD_AND_PAYMENTS.md`
   - Pricing/fees → `PRD.md` 5.6, `USSD_AND_PAYMENTS.md` fees
   - Aggregator/payments → `ARCHITECTURE.md`, `USSD_AND_PAYMENTS.md`
   - Morale/free votes (#29) → `PRD.md` 5.4a, `CLAUDE.md` rule 3a, `USSD_AND_PAYMENTS.md`
7. If the decision adds a new rule that every future change must respect, add it to the working rules in `CLAUDE.md`.

## Output

List each file changed and what changed in one line each. If anything in the codebase now contradicts the decision, say so and offer to fix it, but don't change code in this skill.

Never settle a question the developer hasn't actually settled. "Let's go with X for now" counts; "what do you think about X?" does not.
