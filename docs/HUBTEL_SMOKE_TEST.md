# Hubtel smoke test

How to push the first real payment through under observation, and settle the
two things the code could not: the payload shape and the endpoints. Do this
on the Hubtel sandbox first, then once more on live with a GHS 1 vote.

## Before you start

1. In the Hubtel merchant dashboard, note the client id, client secret and
   merchant account number, and register the callback URL
   `https://<your host>/api/payments/callback/hubtel`.
2. Ask Hubtel to allowlist the server's outbound IP for the transaction
   status API. Without it every callback is rejected, because the adapter
   confirms through that API before crediting (payment rule 2). The app
   runs on Vercel (decision #24), whose functions have no fixed outbound
   IP by default: either enable Vercel's static egress IP feature for the
   project, or route the status calls through a small relay with a fixed
   address and point `HUBTEL_STATUS_URL` at it. Confirm which with Hubtel
   before the first live payment.
3. Set the env on the host: `PAYMENT_PROVIDER=hubtel`, the three `HUBTEL_*`
   credentials, `HUBTEL_PAYLOAD_SHAPE`, `NEXT_PUBLIC_APP_URL`,
   `INTERNAL_JOB_SECRET`. Leave `HUBTEL_RECEIVE_URL` and `HUBTEL_STATUS_URL`
   at their defaults unless Hubtel's docs for your account say otherwise.

## The run

1. Create a draft event with a price of GHS 1.00, one category, one nominee,
   and take it live.
2. Open the nominee's vote page and pay for one vote with a test number.
   The `payments` row should appear as `pending` with `providerReference`
   either Hubtel's transaction id or `local_<id>`.
3. Approve the prompt on the phone. Watch the server log for
   `[payments.callback.hubtel]`. One of three things happens:
   - `outcome: confirmed`: the shape and endpoints are right. Done.
   - HTTP 400 `Unverified callback`: the callback parsed but the status API
     said unpaid or could not be parsed. Compare the raw body Hubtel sent
     (log it once from the route if needed) with the fixtures in
     `src/lib/__tests__/hubtel-parse.test.ts` and switch
     `HUBTEL_PAYLOAD_SHAPE` or extend the parser.
   - HTTP 500: the status API call failed. Check the allowlist and
     `HUBTEL_STATUS_URL`. Hubtel retries, so nothing is lost.
4. Replay the callback (resend the same body) and confirm the route answers
   `outcome: duplicate` with no second vote.
5. With the payment still pending, call
   `POST /api/internal/payments/reconcile` with the `x-internal-secret`
   header after ten minutes and confirm it settles the payment.
6. Check the `payments` row: `status: success`, `rawCallback` holds both the
   callback and the status response, `network` is set, and one `votes` row
   and one `ledger_entries` row exist for it.

## What to record afterwards

- The confirmed payload shape and endpoints, in `.env.example` and in
  `docs/USSD_AND_PAYMENTS.md`.
- Hubtel's reported charges on the test payment, as input to
  OPEN_QUESTIONS #36.

## USSD

1. In the Hubtel dashboard, point the shortcode (or your extension of the
   shared code) at `https://<your host>/api/ussd/hubtel`. If Hubtel lets you
   set credentials for the callback, put the password in
   `USSD_WEBHOOK_SECRET`.
2. Dial the code from a test phone and walk the menu: 1, the nominee's code,
   a quantity, 1 to confirm. If the first screen does not appear, log one raw
   request body from the route and compare it with the fixtures in
   `src/lib/__tests__/ussd-handler.test.ts` ("Hubtel USSD transport"); only
   `src/lib/ussd/hubtel.ts` needs to change.
3. Approve the MoMo prompt. From here it is the payment smoke test above: the
   callback, the status check, one vote, one ledger row.
