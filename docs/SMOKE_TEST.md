# Payments and USSD smoke test

How to push the first real payment and USSD session through under
observation. Payments run on **Paystack** and USSD on **Hubtel** (decided
2026-11-12, amending #11). Do the payment run in Paystack test mode first,
then once more live with a GHS 1 vote.

## Before you start

1. **A public URL.** Paystack and Hubtel call the app, so it must be
   reachable: a Vercel preview or production deploy, or, for a local run, a
   tunnel to `localhost:3000` (e.g. `cloudflared tunnel --url
   http://localhost:3000`). Set `NEXT_PUBLIC_APP_URL` to it.
2. **Paystack dashboard** (Settings → API Keys & Webhooks), once for test
   mode and again for live:
   - Copy the secret key (`sk_test_…`, later `sk_live_…`) into
     `PAYSTACK_SECRET_KEY`. Never the public key, never in the browser.
   - Set the webhook URL to `https://<your host>/api/payments/callback/paystack`.
   - Turn off customer email receipts: each charge uses the placeholder
     email `<paymentId>@<PAYSTACK_CUSTOMER_EMAIL_DOMAIN>` because voters give
     no email.
3. **Env on the host:** `PAYMENT_PROVIDER=paystack`, `PAYSTACK_SECRET_KEY`,
   `PAYSTACK_CUSTOMER_EMAIL_DOMAIN` (a domain you own), `NEXT_PUBLIC_APP_URL`,
   `INTERNAL_JOB_SECRET`. Optionally `PAYSTACK_CALLBACK_IPS` with Paystack's
   published webhook IPs (check the webhooks page for the current list); the
   signature is checked either way.

No outbound IP allowlisting is needed: Paystack's verify API takes the secret
key alone, so Vercel's lack of a fixed egress IP does not matter.

## The run (Paystack)

1. Create a draft event priced at GHS 1.00 with one category and one nominee,
   and take it live.
2. Open the nominee's vote page and pay for one vote. The `payments` row
   appears as `pending` with `provider: paystack` and `providerReference`
   equal to its own id.
   - If the page asks for an SMS code, the network wanted a one-time code
     (`send_otp`); enter it. Note which network did this.
   - In test mode Paystack may approve at once without a prompt.
3. Approve the prompt. Watch the log for `[payments.callback.paystack]` and
   the Paystack dashboard's webhook log:
   - `outcome: confirmed`: done.
   - HTTP 400 `Unverified callback`: the signature failed (wrong key, or a
     test-mode key against a live webhook) or the event was not a GHS
     `charge.success`.
   - `outcome: mismatch` in the payment's `rawCallback`: Paystack reported a
     different amount. Nothing was credited; compare the two.
4. Resend the webhook from the Paystack dashboard and confirm the route
   answers `outcome: duplicate` with no second vote.
5. Start a second payment and ignore the prompt. After ten minutes call
   `POST /api/internal/payments/reconcile` with the `x-internal-secret`
   header and confirm it marks the payment `failed` once Paystack reports it
   abandoned.
6. Check the paid row: `status: success`, `rawCallback` holds the webhook,
   `network` is set, and one `votes` row and one `ledger_entries` row exist.
7. Repeat steps 2–3 for a ticket purchase.

## What to record afterwards

- Which networks asked for a one-time code, in `docs/USSD_AND_PAYMENTS.md`.
- Paystack's fee on the test payment (Paystack deducts it from settlement),
  to check the off-the-top split decided for #36.

## USSD (Hubtel)

1. In the Hubtel dashboard, point the shortcode (or your extension of the
   shared code) at `https://<your host>/api/ussd/hubtel`. If Hubtel lets you
   set credentials for the callback, put the password in
   `USSD_WEBHOOK_SECRET`. Set `USSD_SHORTCODE` so flyers print it.
2. Dial the code from a test phone and walk the menu: 1, the nominee's code,
   a quantity, 1 to confirm. If the first screen does not appear, log one raw
   request body from the route and compare it with the fixtures in
   `src/lib/__tests__/ussd-handler.test.ts` ("Hubtel USSD transport"); only
   `src/lib/ussd/hubtel.ts` needs to change.
3. Approve the MoMo prompt. From here it is the Paystack run above: the
   signed webhook, one vote, one ledger row. If the network wants a one-time
   code, the session ends telling the voter to use the website (a USSD
   session cannot collect the SMS code); the payment stays pending until
   reconciliation fails it.

## Hubtel payments (not in use)

The Hubtel payment adapter (`src/lib/payments/hubtel/`) is kept and tested
but no longer selected. To use it, set `PAYMENT_PROVIDER=hubtel` and the
`HUBTEL_*` variables in `.env.example`. It confirms every callback through
Hubtel's transaction status API, which only answers allowlisted IPs, so the
server then needs a fixed outbound IP (a Vercel static-IP add-on or a relay
behind `HUBTEL_STATUS_URL`), and `HUBTEL_PAYLOAD_SHAPE` must be confirmed
against Hubtel's sandbox by comparing a real callback with the fixtures in
`src/lib/__tests__/hubtel-parse.test.ts`.
