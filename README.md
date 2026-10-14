# voteapp (working name)

Multi-tenant paid voting platform for award shows and pageants, launching at KNUST, with a built-in flyer engine. Product and architecture docs live in `docs/`; start with `CLAUDE.md`.

The stack, folder layout, UI kit, icons and fonts mirror the pickLT project (see `docs/ARCHITECTURE.md`): Next.js 15, React 19, Tailwind CSS 4, Headless UI, Heroicons and Hugeicons, Poppins, and Appwrite for auth, database, storage, functions and realtime.

## Getting started

```bash
cp .env.example .env.local   # then fill in the Appwrite project and a SESSION_SECRET
npm install
npm run dev                  # http://localhost:3000
```

```bash
npm run build   # production build
npm run lint    # next lint
npm test        # vitest, src/**/__tests__/**/*.test.ts
```

Appwrite schema and buckets are managed with the Appwrite CLI against `appwrite.config.json`:

```bash
appwrite login
appwrite push settings   # auth methods
appwrite push tables     # 19 tables
appwrite push buckets    # photos, templates, fonts, flyers
```

Add your web origin as a platform in the Appwrite console so the browser can load photos, backgrounds and fonts.

## Environment

Everything is documented in `.env.example`. Beyond the Appwrite keys and `SESSION_SECRET`, the parts that matter:

| Variable | What it does |
|---|---|
| `PAYMENT_PROVIDER` | `hubtel` for real money, `mock` for development (refuses to run in production) |
| `HUBTEL_*` | Merchant credentials, payload shape and endpoints; see `docs/HUBTEL_SMOKE_TEST.md` |
| `PLATFORM_COMMISSION_BPS` | Overrides the 10% default |
| `TICKET_SECRET` | Signs ticket QR tokens |
| `USSD_SHORTCODE` | Printed on flyers once Hubtel assigns it |
| `USSD_WEBHOOK_SECRET` / `USSD_CALLBACK_IPS` | At least one is required in production for the USSD webhook |
| `EMAIL_PROVIDER` | `log` until a provider is chosen (#32) |
| `CRON_SECRET` | Set by Vercel for the reconciliation cron in `vercel.json` |

## What is built

Organizer signup and workspaces; events with rounds, categories and nominees; paid voting on the web and by USSD through one pipeline with the Hubtel adapter; the nominee portal with claim links and photos; the flyer engine (Fabric.js editor, `@napi-rs/canvas` renderer); tickets with signed QR codes and an entrance scanner; the cumulative round report as PDF. See `docs/OPEN_QUESTIONS.md` for what each placeholder waits on.

Added beyond pickLT: `@napi-rs/canvas`, `fabric`, `fflate`, `pdfkit`, `qrcode`. The canvas and `sharp` are server externals in `next.config.mjs`.
