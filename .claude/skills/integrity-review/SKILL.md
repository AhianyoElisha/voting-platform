---
name: integrity-review
description: Review code that touches votes, payments, tickets, rounds, free votes or tenant data against the non-negotiable rules in CLAUDE.md and USSD_AND_PAYMENTS.md. Run before merging any change in those areas. Usage: /integrity-review [path or "staged"]
---

# /integrity-review

A focused review for the parts of this system where a bug costs real money or real trust.

## Scope

If a path is given, review it. If "staged" is given, review `git diff --cached`. Otherwise review `git diff` plus any untracked files under the payments, votes, tickets, rounds, ussd and tenant/data-access areas.

## Read first

`CLAUDE.md` (working rules) and `docs/USSD_AND_PAYMENTS.md` (payment rules). Read `docs/DATA_MODEL.md` for the integrity constraints.

## Checklist

Go through every item and report a finding or an explicit "OK" with the evidence.

**Paid votes and tickets**
- A `Vote` with `source = paid` (or a `Ticket`) is only created when a `Payment` moves to `success`, inside the same DB transaction.
- The `success` transition only happens from a verified provider callback (signature checked) or a status check against the provider API — never from a client request.
- Callback handling is idempotent: keyed on `providerReference`, safe to replay, no double-counting.
- `Payment` is created as `pending` before any debit is started.
- Money fields are integer pesewas. No floats, no `Number(amount) / 100` in the write path.
- Votes attach to the round that was live when the payment was initiated.

**Free votes and morale candidates**
- Free votes have `source = free`, `paymentId = null`, `grantedBy` set, and an `AuditLog` row in the same transaction.
- Only organizer admins or super admins can grant them. Check the authorization, not just the UI.
- Free votes never appear in revenue, ledger credits or payouts.
- The per-event and platform-level switches are respected.
- Nothing hides the paid/free distinction on public results unless `DECISIONS.md` says it may (see OPEN_QUESTIONS #29).

**Rounds**
- Writes to a `closed` round are rejected.
- Tallies are computed per round; the cumulative report sums rounds and doesn't double-count.

**Tenant isolation**
- Every query on tenant-owned data is scoped by `organizationId` from the authenticated membership, not from the request body or URL alone.
- Nominee portal users can only read/write their own `Nominee` row.

**Tickets**
- `qrToken` is signed, not a bare id.
- Scan is an atomic `valid → used` transition (no check-then-update race).

**Operational**
- Webhook handlers return quickly and do heavy work in a transaction or job.
- Raw callback payloads are stored.
- Rate limiting exists on public vote/ticket initiation endpoints.

## Output

Findings first, most severe at the top, each with file:line, what's wrong, and a concrete fix. Then the "OK" items in a short list. End with a one-line verdict: safe to merge, or not, and why.
