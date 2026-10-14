# Architecture (Proposed)

Status: **proposal**. Nothing here is final until it is recorded in `DECISIONS.md`.

## High-level components

```
                ┌──────────────────────────────┐
  Voters (web) ─►  Public site (Next.js)       │
                │  events / nominees / vote    │
                └──────────────┬───────────────┘
                               │
  Organizers ──► Organizer dashboard ──┐       │
  Super admin ─► Admin console ────────┤       │
  Designers ──► Flyer template editor ─┤       │
                                       ▼       ▼
                         ┌──────────────────────────┐
                         │  API layer (Next.js      │
                         │  route handlers/services)│
                         └───┬────────┬────────┬────┘
                             │        │        │
                    PostgreSQL   Object storage  Job queue
                    (Prisma)     (photos, fonts, (flyer renders,
                                  templates,      payment
                                  flyers)         reconciliation)
                             ▲
   USSD aggregator ──────────┤  USSD session webhook
   MoMo / payment provider ──┘  payment callback webhook
```

## Proposed stack

| Concern | Proposal | Notes |
|---|---|---|
| Web app and API | Next.js (App Router) + TypeScript | One codebase for public site, dashboards and API. |
| Database | PostgreSQL + Prisma | Relational data and transactions suit votes and payments. |
| Auth | Auth.js or similar | Organizers, staff and admins only. Voters need no account. |
| Storage | S3-compatible (e.g. Cloudflare R2) | Nominee photos, templates, fonts, generated flyers. |
| Flyer editor | Fabric.js | Canvas with layers in the browser. |
| Flyer rendering | Server-side (Fabric on Node with node-canvas, or a headless browser) | Server rendering keeps output consistent and allows bulk generation. |
| Image processing | Sharp | Resizing, compression and format conversion. |
| Background jobs | BullMQ + Redis, or a Postgres-based queue | Bulk flyer generation and payment reconciliation. |
| USSD | Aggregator (Hubtel / Nsano / Arkesel / other: **TBD**) | Webhook-driven sessions. |
| Payments | MoMo via the aggregator; Paystack possible for cards | **TBD**. |
| Hosting | **TBD** | Needs reliable public HTTPS endpoints for webhooks. |

## Multi-tenancy

- Shared database with an `organizationId` column on all tenant-owned tables.
- A data-access layer that always requires a tenant context, so route handlers never write raw unscoped queries.
- Public pages resolve tenants by slug (`/o/{slug}/...`). Subdomain support is optional and can come later.

## Key flows

1. **Web vote:** voter picks nominee and quantity → server creates a `PaymentIntent` (pending) → provider sends MoMo prompt → provider callback (verified) → in one DB transaction: mark payment successful and create `Vote` rows → live tally updates.
2. **USSD vote:** aggregator sends session requests → server returns menu text → on confirmation, server starts a MoMo debit → the payment callback follows the same path as step 1. See `USSD_AND_PAYMENTS.md`.
3. **Flyer generation:** nominee created or updated → job queued → renderer loads template, fills slots, exports PNG/JPG → stored and linked to the nominee. See `FLYER_ENGINE.md`.

## Real-time results

Start with short-interval polling or server-sent events from a cached tally. Move to websockets only if needed.

## Reliability notes

- Webhook handlers must be fast and idempotent. Acknowledge quickly, process inside a transaction.
- A reconciliation job checks pending payments against the provider's status API, so votes are never lost to missed callbacks.
- Rate-limit public vote endpoints.
