# USSD and Payments

## Agreed
- Voting is **paid**.
- Voters can use **web** or **USSD only**. Both paths are independent and feed the same tally.
- USSD works without a smartphone or data, which is essential for reaching everyone.
- Each nominee has a short code, unique across the platform, used on both paths.

## How USSD works (background)
We don't run a USSD gateway ourselves. An aggregator provides a shortcode (or an extension of a shared code) and forwards each step of a session to our webhook. We reply with the next menu text. **The USSD aggregator is Hubtel** (decided 2026-10-14, #11). Mobile-money payments, including those started from a USSD session, go through Paystack (amended 2026-11-12; see DECISIONS). Whether the shortcode is dedicated or shared, and the fees, are confirmed during Hubtel onboarding.

## USSD flow (built; the ticket branch below is decided but not built, #31)

```
*XXX*YY#
1. Vote
2. Buy ticket
3. Help
> 1
Enter nominee code:
> 42
Miss Social Science
Ama Owusu
GHS 1.00 per vote
Enter number of votes:
> 10
Pay GHS 10.00 for 10 votes for Ama Owusu?
1. Confirm
2. Cancel
> 1
A MoMo prompt has been sent. Approve with your PIN.
```

Ticket branch (decided 2026-11-12 and 2026-11-13, not built; the menu answers "coming soon" until it is):

```
> 2
Enter event code:
> 17
Faculty Dinner 2026
1. Regular – GHS 50
2. VIP – GHS 100
> 1
How many tickets?
> 2
Pay GHS 100.00 for 2 Regular tickets?
1. Confirm  2. Cancel
> 1
MoMo prompt sent. Your ticket link will be sent by SMS.
```

Decided 2026-11-12 (#31): USSD can't collect an email address comfortably, so a USSD ticket purchase sends a link to the ticket page by SMS to the paying number. The menu does not ask for an email. The SMS goes through Hubtel (decided 2026-11-13). The branch is not built yet.

Considerations:
- USSD sessions time out after roughly 60–180 seconds, so keep menus short.
- The MoMo approval prompt arrives outside the USSD session. The vote is counted only when the payment callback confirms it.
- No SMS receipt is sent after a vote (decided 2026-11-12, #14): USSD voters rely on the network's own payment message.
- Code scheme (decided 2026-10-14, #12): one shared shortcode with **platform-wide unique nominee codes**. Voting never asks for an event code. The ticket branch still uses the event code (`Event.eventCode`), because tickets belong to an event rather than a nominee.

## Built (2026-10-14): web votes behind a provider interface

`src/lib/votes-server.ts` implements the rules below for the web path. `src/lib/payments/provider.ts` is the provider boundary. `src/lib/payments/paystack/` is the adapter in use (decided 2026-11-12, amending #11): a Ghana mobile-money charge through Paystack's Charge API with our payment id as the `reference`; a `charge.success` webhook is accepted only with a valid `x-paystack-signature` (HMAC-SHA512 of the raw body with the secret key) and in GHS, which is rule 2's verified callback; other signed events are acknowledged and ignored; reconciliation asks `GET /transaction/verify/{reference}` (`success` confirms; `failed`, `abandoned` and `reversed` fail a pending payment, and a later success still overrides that). Some numbers get `send_otp` first: the web pages show a code box (`POST /api/public/payments/{id}/otp`, which only continues the charge), and USSD ends the session asking the voter to use the website. `src/lib/payments/hubtel/` is the earlier Hubtel adapter, kept but not selected: Hubtel does not sign callbacks, so there a callback is only a hint and the verdict comes from Hubtel's status API. The reported amount must equal the payment's amount or the pipeline refuses with `mismatch`, keeps the evidence on the row and audits once. A verified result matches its payment by provider reference, or by our payment id when the same adapter verified it, so a provider that reports a different transaction id than it gave at initiation still credits the right payment. Reconciliation treats a provider fault on one payment as skipped and continues. Confirm the Paystack flow in test mode and then live (`docs/SMOKE_TEST.md`). The `mock` adapter stays for development, refuses to run in production, and its callbacks are HMAC-signed so the verification path is real. The commission rate defaults to 10% (`DEFAULT_COMMISSION_BPS` in `src/lib/fees.ts`), overridable platform-wide with `PLATFORM_COMMISSION_BPS` and per organization with `commissionRate`. Late callbacks are honoured against the round recorded at initiation and audited as `vote.late` (decided 2026-11-12, #13; `applyLatePaymentPolicy`). Quantity: minimum 1; the maximum is a money cap per payment, GHS 2,000 by default and a platform setting (decided 2026-11-13, #16; built 2026-11-13: `src/lib/vote-limits.ts`, `VOTE_PAYMENT_MAX_PESEWAS`; the web form, the USSD menu and `initiateVotePayment` all apply it, and a single vote can always be bought). Rate limits are shared across server instances (`src/lib/rate-limit.ts`: an atomic counter per window in the `rate_limits` table, fail-open if Appwrite is unreachable); the limit values are final (decided 2026-11-13, #27). Reconciliation runs through `POST /api/internal/payments/reconcile` behind `INTERNAL_JOB_SECRET`; scheduled as a Vercel cron job in `vercel.json` once a day at 03:00 UTC (GET with Vercel's `CRON_SECRET` bearer token), because the Hobby plan allows only daily crons. Paystack's signed webhook stays the primary path and Paystack retries failed deliveries, so the daily run is a backstop. For a tighter schedule, either move to Vercel Pro and set `*/10 * * * *`, or have an outside scheduler POST to the same route with the `x-internal-secret` header. `.github/workflows/reconcile.yml` does that every ten minutes from GitHub Actions (best effort: GitHub can start scheduled runs late); it needs the `APP_URL` repository variable and the `INTERNAL_JOB_SECRET` repository secret. If the provider's reference cannot be stored after `initiate`, the payment stays `pending` under its `local_<id>` placeholder: a callback that echoes our payment id (`clientReference`) still matches it, and reconciliation re-checks it by payment id, so a started debit is never orphaned.

## Built (2026-10-14): USSD voting

`src/lib/ussd/menu.ts` is the menu as a pure state machine; `handler.ts` runs it against a session row and the same `quoteVote` and `initiateVotePayment` the web page uses, with `channel = ussd` and the phone from the aggregator; `hubtel.ts` is the only file that knows Hubtel's USSD request and response JSON (to confirm on the sandbox, see `docs/SMOKE_TEST.md`). The webhook is `POST /api/ussd/hubtel`, guarded by a shared secret and/or IP allowlist; in production at least one must be set or every call is refused. Initiation has one per-phone budget shared by web and USSD (`INITIATIONS_PER_PHONE_PER_MINUTE` in `votes-server.ts`; final, #27), since every initiation sends a real MoMo prompt. Confirming is the only step that creates a (pending) Payment; the vote is counted by the payment callback like a web vote. Tickets over USSD show "coming soon" until ticket delivery over USSD is decided (#31); web ticketing is built. `/dev/ussd` is a simulator for development and demos.

Menu as built: `Vote / 1. Vote 2. Buy ticket 3. Help` → `Enter nominee code:` → `<category> / <nominee> / GHS x.xx per vote / Enter number of votes:` → `Pay GHS y.yy for n votes for <nominee>? 1. Confirm 2. Cancel` → `A MoMo prompt has been sent to your phone…`.

## Built (2026-10-14): tickets on the web

`src/lib/tickets/`: tiers, purchase initiation (same shape as a vote: pending Payment with `purpose = ticket` before the debit, availability counts recent pending payments as soft reservations), confirmation inside `confirmPayment`'s transaction (Payment success, one Ticket per seat with a signed QR token, tier counter, `ticket_credit` ledger row), and the atomic entrance scan. An oversell by in-flight payments issues the paid tickets and writes a `ticket.oversold` audit row rather than stranding a buyer. Tickets by USSD stay "coming soon" until delivery is decided (#31). When the buyer gives an email, the tickets go out through Resend (#32, decided 2026-11-12) with one QR PNG attached per ticket, once per purchase (an idempotency key per payment); the buyer always has the ticket links on the confirmation page and at `/t/<token>`.

## Payment rules (non-negotiable)

1. Create the `Payment` as `pending` before starting a debit.
2. Count paid votes (and issue tickets) only from a **verified** provider callback, or from a status check against the provider's API.
3. Callbacks are idempotent, keyed on `providerReference` (unique index).
4. In one Appwrite database transaction: payment becomes `success` with the provider's charge and the settled split recorded, the Vote (or Ticket) is created against the event's live round, the tally is updated, and the ledger is credited with the organizer's net share.
4a. Votes are attached to the round that is live when the payment is **initiated**, at that round's price per vote (its own when it sets one, else the event's; decision #30). If a round closes while a payment is pending, the late callback is still credited to that round (decided 2026-11-12, #13).
5. A reconciliation job re-checks stale `pending` payments.
6. Votes for an event that has closed are rejected before payment starts. Late callbacks for payments that started before close are honoured (decided 2026-11-12, #13).
7. Store raw callback payloads for audits and disputes.

## Refunds and disputes
Decided 2026-11-12 (#15), not built yet: refunds are manual. The super admin reviews the case in the console, returns the money outside the platform (Paystack dashboard or mobile money) and marks the payment `refunded`. Marking it removes the votes (only while their round is still open) or cancels the tickets, and debits the organizer's wallet, with an audit row. A closed round never changes (working rule 3b): there the tally stays, the money still goes back and the wallet is still debited, and the cumulative report notes the refund. The console never calls Paystack's refund API.

## Free votes
Free votes (see PRD 5.4a; decision #29: always shown separately from paid votes in public results) never pass through this pipeline. They have no Payment, are created only by an organizer admin or super admin, carry `source = free` and `grantedBy`, and are audited. They must never be counted in revenue or payouts.

## Fees
- The platform takes 10% of the gross paid amount per vote and per ticket; the organizer's 90% goes to their wallet. Commission only, no subscription (decided 2026-10-14, #2). For reference, the main competitor charges 7–10% plus optional subscriptions.
- Rates are stored in basis points (`1000` = 10%): the platform default in `PLATFORM_COMMISSION_BPS`, a per-organization override in `Organization.commissionRate`.
- Paystack's and the MoMo networks' charge on a payment comes off the gross first (the fee Paystack reports for that payment), and the remainder is split between the organizer and the platform (decided 2026-11-13, #36). *Built 2026-11-13 (`settleWithProviderFee` in `src/lib/fees.ts`): at confirmation, in the same transaction as the vote or tickets, the fee Paystack reports (`fees`, pesewas) is stored as `Payment.providerFee`, the platform's and organizer's parts are recomputed on the remainder in the proportion fixed at initiation, and the ledger is credited the organizer's settled part. The three parts always sum to the amount. A payment with no reported fee, or one above 10% of the amount (not believed), keeps its initiation split. To confirm on the first test payment: that Paystack's `fees` is in pesewas (`docs/SMOKE_TEST.md`).*
