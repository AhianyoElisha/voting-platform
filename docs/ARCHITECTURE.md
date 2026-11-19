# Architecture

Status: **decided 2026-10-14** (see `DECISIONS.md`; was OPEN_QUESTIONS #23). The stack, folder structure, UI kit, icons and fonts mirror the **pickLT** project at `../moverapp/pickLT`. When this document and pickLT disagree on *how* something is done, look at pickLT first, do it that way, and record the difference here. Hosting is settled too (2026-10-14, #24): Vercel for the Next.js app, Appwrite Cloud in Frankfurt for the backend.

## Reference project: pickLT

pickLT is a Next.js 15 booking and rental app on Appwrite, grown from the Chisfis template. Everything below was read from it on 14 Oct 2026. Lift the shell (layout, theme, shared components, lib helpers, config files) and leave the moving-domain code behind.

| Concern | What pickLT does, and what we do |
|---|---|
| Framework | Next.js 15.3 (App Router), React 19, TypeScript strict, `@/*` → `src/*`. |
| Styling | Tailwind CSS 4 via `@tailwindcss/postcss`. Theme tokens live in `src/styles/tailwind.css` (`primary` indigo, `secondary` teal, `neutral` grey scales, `container` and `pl-container` utilities). Plugins: typography, forms, aspect-ratio. Dark mode is the `.dark` class on `<html>`, toggled by `ThemeProvider`. |
| UI primitives | Headless UI 2 plus the shared components in `src/shared` (`Button`, `ButtonPrimary` / `ButtonSecondary` / `ButtonThird`, `Input`, `Select`, `Textarea`, `Checkbox`, `radio`, `switch`, `listbox`, `combobox`, `table`, `Pagination`, `NcModal`, `Badge`, `Tag`, `Avatar`, `Heading`, `Logo`, `SwitchDarkMode`, `navbar`). Copy these, don't re-invent them. |
| Icons | Heroicons (`@heroicons/react`, the main set) and Hugeicons (`@hugeicons/react` with `@hugeicons/core-free-icons`). No other icon packs. |
| Font | Poppins through `next/font/google`, weights 300–700, applied on `<html>` in `src/app/layout.tsx`. Flyer templates use their own uploaded fonts; this is the app font only. |
| Motion and carousels | Framer Motion; Embla carousel (with autoplay) and the `use-carousel-*` hooks. |
| i18n | pickLT ships eight locales with react-i18next and a cookie-resolved locale. We keep the same provider wiring but ship `en` only. |
| Backend | **Appwrite**: Auth, Databases, Storage, Functions (Node 22 runtime), Realtime, Messaging. Project settings, the schema and function definitions live in `appwrite.config.json`, in the current CLI shape (`tablesDB` and `tables` with `columns`, as pickLT's), pushed with `appwrite push tables` and `appwrite push functions`. Table ids are fixed slugs (`users`, `organizations`, ...), so code needs no env var per table; see `src/lib/constants.ts`. |
| Appwrite access | Browser: `appwrite` client SDK in `src/lib/appwrite.ts`. Server: `node-appwrite` admin client in `src/lib/appwrite-server.ts` with the `withRetry` wrapper. Own signed session cookie (`SESSION_SECRET`) on top of Appwrite sessions, with `/api/auth/*` routes. |
| Reads vs writes | Reads: Next.js API routes and server components. Sensitive or multi-document writes: Appwrite Functions in `functions/<name>/` or server-only API routes, never the browser SDK. See the decision matrix in pickLT's `BACKEND_ARCHITECTURE.md` §7. |
| Images | Sharp. `next/image` with the Appwrite endpoint in `remotePatterns`. |
| Monitoring | Sentry (`@sentry/nextjs`) with the `/monitoring` tunnel route. |
| Tests | Vitest, node environment, `src/**/__tests__/**/*.test.ts`. |
| Tooling | Prettier (no semicolons, single quotes, width 120, organize-imports and tailwind plugins), ESLint `next/core-web-vitals`, `.npmrc` with `legacy-peer-deps=true`. Development-only aids: the `mock` payment provider with its confirm panel on the vote and ticket pages, and the USSD simulator at `/dev/ussd`; both refuse to run in production. |
| Hosting | Same as pickLT (decided 2026-10-14, #24): the Next.js app on Vercel, Appwrite Cloud in Frankfurt (`fra.cloud.appwrite.io`, already the default in `appwrite.config.json` and `.env.example`). Scheduled jobs (payment reconciliation) run as Vercel cron jobs declared in `vercel.json`, authenticated with Vercel's `CRON_SECRET`; once a day while the project is on the Hobby plan, which allows only daily crons. Vercel functions have no fixed egress IP by default; that only matters if payments go back to Hubtel, whose status API allowlist needs one (see `docs/SMOKE_TEST.md`). Paystack, the payment provider since 2026-11-12, does not. |

Look and feel (added 2026-11-12, on top of pickLT's theme tokens): a small set of shared styles in `src/styles/tailwind.css` used by every area (public site, organizer dashboard, nominee portal, admin console): `surface` and `surface-hover` for cards, `stat` for figure tiles, `section-title` for section headings, `btn-brand` for the main call to action and `text-brand` for gradient headline text. `src/components/PageBackdrop.tsx` (pickLT's `BgGlassmorphism` in voteapp's colours) sits behind every page, and `src/components/PhotoAvatar.tsx` shows a nominee's photo or an organization's logo, falling back to initials. New screens should use these instead of spelling out borders, shadows and button colours.

Not carried over: Mapbox and Google Maps, LiveKit calls, Stripe, the moving and vehicle domain, the blog and listing demo pages.

Added for this product (not in pickLT): Fabric.js for the flyer editor and renderer, a PDF generator for the cumulative round report, USSD and mobile-money webhooks, QR tickets. Built so far: the flyer engine with Fabric.js in the editor and `@napi-rs/canvas` as the server renderer plus `fflate` for ZIP downloads and the bundled Poppins TTFs for the default slot font, traced into the serverless bundle by `outputFileTracingIncludes` in `next.config.mjs` (`src/lib/flyer/`), `qrcode` for ticket QR codes (`src/lib/tickets/`), `pdfkit` for the cumulative round report (`src/lib/report/`), the `PaymentProvider` interface with the Paystack adapter (in use), the Hubtel adapter (kept, not selected) and a mock adapter (`src/lib/payments/`), Appwrite database transactions via `runInTransaction` in `src/lib/db.ts`, `toPlain`/`plainResults` in `src/lib/plain.ts` (a change to pickLT's `appwrite-server.ts` pattern: the admin client's results are converted to plain objects so server components can pass them to client components), the `EmailProvider` boundary in `src/lib/email/` with the Resend adapter (decided 2026-11-12, #32) and a log adapter for development, `ag-psd` for PSD import in the template editor (loaded only when a PSD is imported; `src/components/flyer/psd-import.ts`), Google Fonts as the shared platform font library fetched on demand (`src/lib/flyer/google-fonts.ts`, no API key), and an in-memory Appwrite fake for tests (`src/lib/__tests__/fake-appwrite.ts`).

## Folder layout (same as pickLT)

```
src/app/(app)       public site: organizer pages, events, nominees, vote, tickets
src/app/(auth)      login, signup, forgot-password, reset-password (Appwrite recovery)
src/app/(account)   the user's account page and the organizer dashboard (events, nominees, flyers, tickets, report, team, payouts, settings)
src/app/(nominee)   nominee portal (new route group)
src/app/(admin)     super admin console (new route group): overview, organizations, transactions, payouts, audit
src/app/api         route handlers: reads, auth, webhooks (ussd, payments)
src/components      feature components, grouped by area
src/shared          UI primitives lifted from pickLT
src/lib             appwrite clients, domain logic, __tests__
src/hooks  src/context  src/utils  src/styles  src/locales
functions/<name>    Appwrite Functions (writes, scheduled jobs)
```

## High-level components

```
                ┌──────────────────────────────┐
  Voters (web) ─►  Public site (Next.js)       │
                │  events / nominees / vote    │
                └──────────────┬───────────────┘
                               │
  Organizers ──► Organizer dashboard ──┐       │
  Nominees ───► Nominee portal ────────┤       │
  Super admin ─► Admin console ────────┤       │
  Designers ──► Flyer template editor ─┤       │
                                       ▼       ▼
                   ┌────────────────────────────────────┐
                   │  Next.js route handlers (reads,    │
                   │  auth, webhooks, transactional     │
                   │  writes) + Vercel cron             │
                   └───┬────────────┬───────────┬───────┘
                       │            │           │
              Appwrite Databases  Appwrite    Background work
              (collections,       Storage     (flyer renders via
               transactions)      (photos,     after(), reconcile via
                       ▲           fonts,      Vercel cron; Functions
                       │           templates,  later, see functions/)
   Hubtel (USSD) ──────┤           flyers)
   Paystack (MoMo) ────┘  webhooks → Next.js route handlers
```

## Multi-tenancy

- One shared Appwrite database. Every tenant-owned collection has an `organizationId` attribute with an index.
- A data-access layer in `src/lib` takes a tenant context and adds the `organizationId` filter, so route handlers never write raw unscoped queries.
- Tenant isolation is enforced server-side with the admin client plus membership checks from the session (`src/lib/tenant.ts` builds the `TenantContext` from the caller's Membership). Tables have row security off and no table-level grants: the browser SDK is used for Auth only, and all reads and writes go through route handlers or Functions with the admin key. Document permissions can be added later as a second line of defence, not the boundary.
- `/events` is the one public page that reads across tenants (`src/lib/public-events-server.ts`): it lists only what each active organization already publishes at `/o/{slug}`.
- Public pages resolve tenants by slug: `/o/{slug}` is the organization's page (its public events), `/o/{slug}/{eventSlug}` an event, `/o/{slug}/{eventSlug}/vote/{code}` a nominee's vote page. Which event statuses are public is defined once, in `src/lib/public-events.ts`. Subdomains come later and the paths will keep working (decided 2026-11-13, #25).

## Key flows

1. **Web vote:** voter picks nominee and quantity → server creates a `Payment` document (`pending`) → provider sends MoMo prompt → provider callback (verified) → in one Appwrite database transaction: mark payment `success`, create the `Vote`, bump the `RoundEntry` tally, credit the ledger → live tally updates.
2. **USSD vote:** Hubtel posts each session step to a route handler → server returns menu text → on confirmation, server starts a MoMo debit through Paystack → the payment callback follows the same path as step 1. See `USSD_AND_PAYMENTS.md`.
3. **Flyer generation:** nominee photo uploaded → `ensureFlyer` runs after the response (Next's `after()`) → loads template, fills slots, exports PNG/JPG → stored in Appwrite Storage and linked to the nominee. See `FLYER_ENGINE.md`.

## Real-time results

Decided 2026-11-13 (#26): the public event page and the organizer dashboard re-fetch results about every 30 seconds while open; no Appwrite Realtime. *Not built yet: today every page renders on request and shows the tally as of that request.*

## Reliability notes

- Webhook handlers must be fast and idempotent. Acknowledge quickly, process inside a transaction.
- A scheduled job reconciles stale `pending` payments against the provider's status API, so votes are never lost to missed callbacks. It runs as a Vercel cron (`vercel.json`) calling `/api/internal/payments/reconcile`, not as an Appwrite Function (see `functions/README.md`).
- Public vote, ticket, OTP, USSD and claim endpoints are rate-limited across instances (`src/lib/rate-limit.ts`): a fixed-window counter per hashed key in the `rate_limits` table, raised with Appwrite's atomic increment-with-max, behind a per-instance counter that turns away a client already over the limit without a database call. It fails open if Appwrite is unreachable. Expired windows are deleted by the reconciliation cron. The limit values are final (decided 2026-11-13, #27); there is no spike flagging.
