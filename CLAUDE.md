# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this project is

A multi-tenant **paid voting platform** for award shows, pageants, dinner awards and similar events, launching first at **KNUST** (Kwame Nkrumah University of Science and Technology, Kumasi, Ghana).

- **Organizers** (faculties, departments, halls, student groups, event companies) sign up, get their own workspace, and run voting campaigns for their events.
- **Voters** pay to vote, either on the **web** or by dialling a **USSD** code. The two paths are fully independent and feed the same tally. Tickets are sold the same two ways and delivered as QR codes.
- **Nominees** get their own portal: they receive login details by email, upload their photo, and download their auto-generated flyer.
- Events can optionally run in **rounds**, each starting from zero, with a cumulative PDF report at the end.
- **The differentiator:** a built-in **flyer engine**. A designer creates a flyer template once. When an organizer uploads a nominee's photo and details, the platform automatically produces a finished, campaign-ready flyer, with the nominee's voting code and USSD instructions included. Organizers no longer pay a designer per nominee.

Product name: **TBD** (placeholder in code: `voteapp`, so it's easy to rename).

## Read these first

| File | What it covers |
|---|---|
| `docs/PRD.md` | Product requirements, users, features, scope |
| `docs/ARCHITECTURE.md` | Proposed system design and tech stack |
| `docs/DATA_MODEL.md` | Entities and relationships |
| `docs/FLYER_ENGINE.md` | Template editor and flyer generation (the differentiator) |
| `docs/USSD_AND_PAYMENTS.md` | USSD flow, payment confirmation, vote integrity |
| `docs/COMPETITIVE_ANALYSIS.md` | Competitors and how we beat them |
| `docs/OPEN_QUESTIONS.md` | **Decisions not yet made. Check before building anything they touch.** |
| `docs/DECISIONS.md` | Log of decisions already made |

## Project skills

Slash commands in `.claude/skills/` (see `.claude/skills/README.md`): `/onboard` to get oriented, `/feature` to plan before coding, `/decide` to record a settled question, `/integrity-review` before merging anything that touches money or votes, `/doc-check` to find doc/code drift, `/intake` to fold new requirements into the docs. Prefer these over ad-hoc approaches to the same jobs.

## Working rules

1. **Do not settle open questions on your own.** If a task depends on something in `docs/OPEN_QUESTIONS.md`, stop and ask. Alternatively, build behind a clean interface with a clearly marked placeholder, and say so.
2. **Record decisions.** When the developer settles a question, move it from `OPEN_QUESTIONS.md` to `DECISIONS.md` with the date and the reasoning.
3. **Paid votes come only from confirmed payments.** A paid vote is never recorded from a client request or an unconfirmed callback. See `USSD_AND_PAYMENTS.md`.
3a. **Free votes are admin-only and always audited.** They carry `source = free` and `grantedBy`, never touch revenue, and are only creatable by organizer admins or super admins. Morale candidates are flagged `isMorale`. These features are **pending a legitimacy review** (OPEN_QUESTIONS #29): build them behind per-event and platform-level switches, and don't remove the safeguards listed in PRD 5.4a.
3b. **Rounds.** Every vote belongs to a round. Closed rounds are immutable. Tallies are per round; the cumulative report sums across rounds.
4. **Tenant isolation is mandatory.** Every query on tenant-owned data is scoped by `organizationId`. Never trust an organization ID from the client without checking membership.
5. **Payments are idempotent.** Every payment callback is keyed on the provider's transaction reference. Processing the same callback twice must not double-count votes.
6. **Money is stored in pesewas** (integer minor units), never as floats.
7. **Keep the flyer engine lightweight.** It is a template personalizer, not a Photoshop clone. See the scope limits in `FLYER_ENGINE.md`.
8. **Mobile first.** Most voters and many organizers use phones on mobile data. Keep pages light and fast.
9. Write tests for vote counting, payment handling, tenant scoping and nominee-code lookup before calling those features done.
10. **Build it the pickLT way.** Reuse pickLT's shared components, lib patterns (`appwrite.ts`, `appwrite-server.ts`, `withRetry`, session cookie) and conventions rather than introducing new libraries or layouts. If something genuinely has no pickLT equivalent, add it and note it in `ARCHITECTURE.md` under "Added for this product".

## Conventions (decided 2026-10-14; see DECISIONS.md and ARCHITECTURE.md)

- **Mirror pickLT** (`../moverapp/pickLT`). Stack, folder layout, config files, shared components, icons (Heroicons, Hugeicons), font (Poppins) and the Tailwind theme all come from there. Before building a screen or helper, look for how pickLT does it and copy that.
- TypeScript everywhere, strict mode. Next.js 15 App Router for the web app and API routes.
- Appwrite for auth, database, storage, functions and realtime. Browser uses the `appwrite` SDK; API routes use `node-appwrite`. Sensitive writes go through Appwrite Functions or server-only routes, never the browser SDK.
- Tailwind CSS 4 with pickLT's theme tokens; Headless UI; Framer Motion; Vitest for `src/lib`.
- Environment variables are documented in `.env.example` and never committed.
- Currency: GHS. Time zone: Africa/Accra (UTC+0). Store timestamps in UTC.

## Commands

Same scripts as pickLT (the project is not scaffolded yet; these are the targets):

```
npm run dev          # next dev
npm run build        # next build
npm run lint         # next lint
npm test             # vitest run (src/**/__tests__/**/*.test.ts)
npm run test:watch   # vitest
```

Appwrite schema and functions are managed with the Appwrite CLI against `appwrite.config.json` (`appwrite push`).
