# Project skills

These are project-scoped skills. Claude Code picks them up from `.claude/skills/` and exposes each as a slash command. They exist to keep the docs in `docs/` and the code in step, and to make the non-negotiable rules in `CLAUDE.md` hard to skip.

| Command | When to run it |
|---|---|
| `/onboard` | Start of a session, or after a break. Grounded briefing: what's decided, what's open, what's built, what's next. |
| `/feature <desc>` | Before building anything non-trivial. Plans against the PRD and data model, lists blocking open questions, waits for a go-ahead. |
| `/decide <n> <decision>` | When a question in `OPEN_QUESTIONS.md` is settled. Records it in `DECISIONS.md` and updates every affected doc. |
| `/integrity-review [path\|staged]` | Before merging anything that touches votes, payments, tickets, rounds, free votes or tenant data. |
| `/doc-check` | After a chunk of implementation. Finds drift between docs and code and unrecorded decisions. |
| `/intake <notes>` | When new requirements arrive from the sales partner or a client. Gets them into the docs with a saved source and a changelog. |

A typical loop: `/onboard` → `/decide` the questions that block the work → `/feature` → build → `/integrity-review` → `/doc-check`.
