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
appwrite push tables     # 23 tables
appwrite push buckets    # nominee photos, templates, fonts, flyers, organization logos
```

Add your web origin as a platform in the Appwrite console so the browser can load photos, backgrounds and fonts.

## Environment

Everything is documented in `.env.example`. Beyond the Appwrite keys and `SESSION_SECRET`, the parts that matter:

| Variable | What it does |
|---|---|
| `PAYMENT_PROVIDER` | `paystack` for real money, `mock` for development (refuses to run in production) |
| `PAYSTACK_*` | Secret key and customer email domain for payments; see `docs/SMOKE_TEST.md` |
| `HUBTEL_*` | Only if payments run on Hubtel instead (not in use); see `docs/SMOKE_TEST.md` |
| `PLATFORM_COMMISSION_BPS` | Overrides the 10% default |
| `TICKET_SECRET` | Signs ticket QR tokens |
| `USSD_SHORTCODE` | Printed on flyers once Hubtel assigns it |
| `USSD_WEBHOOK_SECRET` / `USSD_CALLBACK_IPS` | At least one is required in production for the USSD webhook |
| `EMAIL_PROVIDER` | `resend` (with `RESEND_API_KEY` and `EMAIL_FROM`), or `log` in development |
| `CRON_SECRET` | Set by Vercel for the reconciliation cron in `vercel.json` |

## Password reset

`/forgot-password` asks Appwrite to email a reset link (`account.createRecovery`), and the link opens `/reset-password`. That page posts the new password to `/api/auth/reset-password`, which completes the recovery on the server and signs the user out everywhere: it deletes their Appwrite sessions, and our session cookie is refused if it was issued before the last password change (`src/lib/session-revocation.ts`; checked against Appwrite's `passwordUpdate`, cached per server instance for a minute). Appwrite sends this email itself, not Resend through `EMAIL_PROVIDER`. In the Appwrite console:

- Add each production and preview hostname as a Web platform. Appwrite refuses a reset link that points anywhere else.
- Optionally, under project Settings → SMTP, send through Resend (`smtp.resend.com`, port 465, user `resend`, the Resend API key as password) so the email comes from your domain, and edit the wording under Auth → Templates → Reset password.

## What is built

Organizer signup and workspaces, each with a public page at `/o/{slug}` listing its events; events with rounds, categories and nominees; paid voting on the web and by USSD through one pipeline with the Paystack adapter (USSD sessions on Hubtel); the nominee portal with claim links and photos; the flyer engine (Fabric.js editor, `@napi-rs/canvas` renderer); tickets with signed QR codes and an entrance scanner; the cumulative round report as PDF; the super admin console at `/admin` (organizations, commission, switches, suspension, transactions, payouts, audit log). To become super admin, set `isSuperAdmin` to true on your row in the `users` table in the Appwrite console. See `docs/OPEN_QUESTIONS.md` for what each placeholder waits on.

Added beyond pickLT: `@napi-rs/canvas`, `fabric`, `fflate`, `pdfkit`, `qrcode`. The canvas and `sharp` are server externals in `next.config.mjs`.
