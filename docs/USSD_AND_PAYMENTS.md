# USSD and Payments

## Agreed
- Voting is **paid**.
- Voters can use **web** or **USSD only**. Both paths are independent and feed the same tally.
- USSD works without a smartphone or data, which is essential for reaching everyone.
- Each nominee has a short code used on both paths.

## How USSD works (background)
We don't run a USSD gateway ourselves. An aggregator provides a shortcode (or an extension of a shared code) and forwards each step of a session to our webhook. We reply with the next menu text. Candidates in Ghana include Hubtel, Nsano and Arkesel; **the provider is TBD**.

## Proposed USSD flow (draft)

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

Ticket branch (draft):

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
- Send an SMS receipt after a successful vote (cost and provider TBD).
- Code scheme: either one shared shortcode with platform-wide unique nominee codes, or an event code followed by a nominee code (see OPEN_QUESTIONS).

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
Free votes (see PRD 5.4a) never pass through this pipeline. They have no Payment, are created only by an organizer admin or super admin, carry `source = free` and `grantedBy`, and are audited. They must never be counted in revenue or payouts.

## Fees
- The platform takes a commission per paid vote and per ticket; the organizer's net share goes to their wallet.
- Rates and the model (commission only, or subscription plus commission) are TBD. For reference, the main competitor charges 7–10% plus optional subscriptions.
- Aggregator and MoMo charges need to be known before rates are set.
