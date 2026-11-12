# USSD and Payments

## Agreed
- Voting is **paid**.
- Voters can use **web** or **USSD only**. Both paths are independent and feed the same tally.
- USSD works without a smartphone or data, which is essential for reaching everyone.
- Each nominee has a short code, unique across the platform, used on both paths.

## How USSD works (background)
We don't run a USSD gateway ourselves. An aggregator provides a shortcode (or an extension of a shared code) and forwards each step of a session to our webhook. We reply with the next menu text. **The USSD aggregator is Hubtel** (decided 2026-10-14, #11). Mobile-money payments, including those started from a USSD session, go through Paystack (amended 2026-11-12; see DECISIONS). Whether the shortcode is dedicated or shared, and the fees, are confirmed during Hubtel onboarding.

## USSD flow (built; the ticket branch below is still a draft, #31)

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

Ticket branch (draft, not built; the menu answers "coming soon" until #31 is settled):

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
MoMo prompt sent. Your QR ticket will be sent by SMS/email.
```

Note: USSD can't collect an email address comfortably, so for USSD ticket purchases send the QR link by SMS to the paying number, with email as an optional follow-up on the web. Confirm this in OPEN_QUESTIONS #31.

Considerations:
- USSD sessions time out after roughly 60–180 seconds, so keep menus short.
- The MoMo approval prompt arrives outside the USSD session. The vote is counted only when the payment callback confirms it.
- Send an SMS receipt after a successful vote (cost and provider TBD, #14).
- Code scheme (decided 2026-10-14, #12): one shared shortcode with **platform-wide unique nominee codes**. Voting never asks for an event code. The ticket branch still uses the event code (`Event.eventCode`), because tickets belong to an event rather than a nominee.

## Built (2026-10-14): web votes behind a provider interface

`src/lib/votes-server.ts` implements the rules below for the web path. `src/lib/payments/provider.ts` is the provider boundary. `src/lib/payments/paystack/` is the adapter in use (decided 2026-11-12, amending #11): a Ghana mobile-money charge through Paystack's Charge API with our payment id as the `reference`; a `charge.success` webhook is accepted only with a valid `x-paystack-signature` (HMAC-SHA512 of the raw body with the secret key) and in GHS, which is rule 2's verified callback; other signed events are acknowledged and ignored; reconciliation asks `GET /transaction/verify/{reference}` (`success` confirms; `failed`, `abandoned` and `reversed` fail a pending payment, and a later success still overrides that). Some numbers get `send_otp` first: the web pages show a code box (`POST /api/public/payments/{id}/otp`, which only continues the charge), and USSD ends the session asking the voter to use the website. `src/lib/payments/hubtel/` is the earlier Hubtel adapter, kept but not selected: Hubtel does not sign callbacks, so there a callback is only a hint and the verdict comes from Hubtel's status API. The reported amount must equal the payment's amount or the pipeline refuses with `mismatch`, keeps the evidence on the row and audits once. A verified result matches its payment by provider reference, or by our payment id when the same adapter verified it, so a provider that reports a different transaction id than it gave at initiation still credits the right payment. Reconciliation treats a provider fault on one payment as skipped and continues. Confirm the Paystack flow in test mode and then live (`docs/SMOKE_TEST.md`). The `mock` adapter stays for development, refuses to run in production, and its callbacks are HMAC-signed so the verification path is real. The commission rate defaults to 10% (`DEFAULT_COMMISSION_BPS` in `src/lib/fees.ts`), overridable platform-wide with `PLATFORM_COMMISSION_BPS` and per organization with `commissionRate`. Late callbacks are honoured against the round recorded at initiation and audited as `vote.late` (#13, placeholder in `applyLatePaymentPolicy`). Quantity has a placeholder ceiling (#16). Rate limits are shared across server instances (`src/lib/rate-limit.ts`: an atomic counter per window in the `rate_limits` table, fail-open if Appwrite is unreachable); the limit values are #27 placeholders. Reconciliation runs through `POST /api/internal/payments/reconcile` behind `INTERNAL_JOB_SECRET`; scheduled as a Vercel cron job in `vercel.json` every ten minutes (GET with Vercel's `CRON_SECRET` bearer token; the Hobby plan only allows daily crons, so a ten-minute schedule needs Pro). If the provider's reference cannot be stored after `initiate`, the payment stays `pending` under its `local_<id>` placeholder: a callback that echoes our payment id (`clientReference`) still matches it, and reconciliation re-checks it by payment id, so a started debit is never orphaned.

## Built (2026-10-14): USSD voting

`src/lib/ussd/menu.ts` is the menu as a pure state machine; `handler.ts` runs it against a session row and the same `quoteVote` and `initiateVotePayment` the web page uses, with `channel = ussd` and the phone from the aggregator; `hubtel.ts` is the only file that knows Hubtel's USSD request and response JSON (to confirm on the sandbox, see `docs/SMOKE_TEST.md`). The webhook is `POST /api/ussd/hubtel`, guarded by a shared secret and/or IP allowlist; in production at least one must be set or every call is refused. Initiation has one per-phone budget shared by web and USSD (`INITIATIONS_PER_PHONE_PER_MINUTE` in `votes-server.ts`, #27 placeholder), since every initiation sends a real MoMo prompt. Confirming is the only step that creates a (pending) Payment; the vote is counted by the payment callback like a web vote. Tickets over USSD show "coming soon" until ticket delivery over USSD is decided (#31); web ticketing is built. `/dev/ussd` is a simulator for development and demos.

Menu as built: `Vote / 1. Vote 2. Buy ticket 3. Help` → `Enter nominee code:` → `<category> / <nominee> / GHS x.xx per vote / Enter number of votes:` → `Pay GHS y.yy for n votes for <nominee>? 1. Confirm 2. Cancel` → `A MoMo prompt has been sent to your phone…`.

## Built (2026-10-14): tickets on the web

`src/lib/tickets/`: tiers, purchase initiation (same shape as a vote: pending Payment with `purpose = ticket` before the debit, availability counts recent pending payments as soft reservations), confirmation inside `confirmPayment`'s transaction (Payment success, one Ticket per seat with a signed QR token, tier counter, `ticket_credit` ledger row), and the atomic entrance scan. An oversell by in-flight payments issues the paid tickets and writes a `ticket.oversold` audit row rather than stranding a buyer. Tickets by USSD stay "coming soon" until delivery is decided (#31). When the buyer gives an email, the tickets go out through Resend (#32, decided 2026-11-12) with one QR PNG attached per ticket, once per purchase (an idempotency key per payment); the buyer always has the ticket links on the confirmation page and at `/t/<token>`.

## Payment rules (non-negotiable)

1. Create the `Payment` as `pending` before starting a debit.
2. Count paid votes (and issue tickets) only from a **verified** provider callback, or from a status check against the provider's API.
3. Callbacks are idempotent, keyed on `providerReference` (unique index).
4. In one Appwrite database transaction: payment becomes `success`, the Vote (or Ticket) is created against the event's live round, the tally is updated, and the ledger is credited with the organizer's net share.
4a. Votes are attached to the round that is live when the payment is **initiated**. If a round closes while a payment is pending, the late callback is still credited to that round (confirm; see OPEN_QUESTIONS #13).
5. A reconciliation job re-checks stale `pending` payments.
6. Votes for an event that has closed are rejected before payment starts. Late callbacks for payments that started before close are honoured (confirm this policy).
7. Store raw callback payloads for audits and disputes.

## Free votes
Free votes (see PRD 5.4a; decision #29: always shown separately from paid votes in public results) never pass through this pipeline. They have no Payment, are created only by an organizer admin or super admin, carry `source = free` and `grantedBy`, and are audited. They must never be counted in revenue or payouts.

## Fees
- The platform takes 10% of the gross paid amount per vote and per ticket; the organizer's 90% goes to their wallet. Commission only, no subscription (decided 2026-10-14, #2). For reference, the main competitor charges 7–10% plus optional subscriptions.
- Rates are stored in basis points (`1000` = 10%): the platform default in `PLATFORM_COMMISSION_BPS`, a per-organization override in `Organization.commissionRate`.
- Whether Paystack's and the MoMo networks' charges come out of the platform's 10% or off the gross is OPEN_QUESTIONS #36. The split is applied to the gross today, so the platform absorbs them until decided.
