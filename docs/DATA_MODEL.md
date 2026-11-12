# Data Model

Status: **built** as of 2026-10-14; every entity below has a table in `appwrite.config.json`. Each entry says when it was built.

Entities are **Appwrite Database collections** (decided 2026-10-14, see `ARCHITECTURE.md`; the Appwrite CLI now calls them *tables* and *columns*, which is how `appwrite.config.json` spells them). Money is stored as integer **pesewas**. Timestamps are stored in UTC; `createdAt` in the entities below is Appwrite's built-in `$createdAt`, not a column. All tenant-owned collections carry an indexed `organizationId`. JSON-shaped fields (`brandColors`, `state`, `rawCallback`, `canvasJson`, `metadata`) are string attributes holding serialized JSON, since Appwrite has no JSON attribute type. Any string column used in an index is declared `varchar` (with its size) in `appwrite.config.json`: Appwrite's `text` type cannot be indexed.

## Entities

### Platform level
- **User**: id (= the Appwrite Auth user id), fullName, email, phone, isSuperAdmin, createdAt. Passwords live in Appwrite Auth, not here. Built 2026-10-14 (`users` table).
- **Organization** (tenant): id, name, slug (platform-wide unique index), logoUrl, brandColors, status (`active` | `suspended`; new organizations start `active`, decided 2026-10-14 (#9); only the super admin suspends), commissionRate (basis points, overrides the platform default of 10% when set; null means use the default; super admin only, #2), moraleCandidatesEnabled and freeVotesEnabled (per-organization switches, super admin only, default true since decision #29), createdAt. Built 2026-10-14 (`organizations` table).
- **Membership**: userId, organizationId, role (`owner` | `admin` | `staff` | `designer` | `scanner`; permissions per role decided 2026-10-14, see DECISIONS and `src/lib/tenant.ts`). Unique on (userId, organizationId). Created by signup (owner) or by accepting a TeamInvite. The user who creates an organization is its `owner`. Built 2026-10-14 (`memberships` table).
- **TeamInvite**: organizationId, email, role (never owner), tokenHash (SHA-256 of a one-time link, seven days, rotated on re-send), expiresAt, invitedBy, status (`pending` | `accepted` | `revoked`), acceptedBy, acceptedAt. Accepting requires a session whose account email matches; for a brand-new account the match is only as good as the link's delivery: emailed through Resend (#32, decided 2026-11-12) it proves inbox access; shared by hand, the link is the credential. Built 2026-10-14 (`team_invites` table, `src/lib/team-server.ts`).
  - Nominees also have a User row (for the nominee portal) but no Membership; their access is through `Nominee.userId` and is limited to their own record.

### Campaigns
- **Event**: id, organizationId, title, slug (unique within the organization), description, coverImageUrl, eventCode (short, for the USSD ticket branch only; voting uses the nominee code alone; null until ticketing), votePrice (pesewas), startsAt, endsAt, status (`draft` | `scheduled` | `live` | `paused` | `closed`), resultsVisibility (`hidden` | `ranking` | `percentage` | `count`; the organizer chooses at creation, no default; decided 2026-11-12, #26), resultsPublishedAt, moraleCandidatesEnabled and freeVotesEnabled (the organizer's per-event opt-ins, PRD 5.4a, decision #29). Built 2026-10-14 (`events` table).
- **Round**: id, eventId, organizationId, number, name, startsAt, endsAt, status (`pending` | `live` | `closed`), closedAt. Every event has at least one round; events "without rounds" have exactly one. Round 1 is created with the event. At most one live round per event; `closed` is terminal. Built 2026-10-14 (`rounds` table).
- **Category**: id, eventId, organizationId, name, order. Built 2026-10-14 (`categories` table).
- **Nominee**: id, categoryId, eventId, organizationId, name, code (short, unique across the whole platform; decided 2026-10-14, see DECISIONS), photoUrl, bio, status (`active` | `withdrawn`), **isMorale** (bool, default false; flagged in admin views and reports, not labelled publicly; decision #29 as amended 2026-11-12), userId (nullable; the nominee's portal login), profileCompletedAt, email, inviteTokenHash, inviteExpiresAt, inviteSentAt, claimedAt. Built 2026-10-14 (`nominees` table). Portal access: the invite creates the Auth user and a one-time claim link (only the token's SHA-256 is stored); the nominee sets a password on the claim page; every portal read and write checks `userId` against the session (`src/lib/portal-server.ts`). Organizer managers can edit name, bio and email and upload the photo at any point until the event is closed (`updateNominee`, `setNomineePhoto` in `src/lib/nominees-server.ts`, audited as `nominee.update` and `nominee.photo`); category, code and `isMorale` are not editable. The email locks once the nominee claims the portal; changing it before then drops any pending invite and deletes the Auth account the invite made for the old address, unless something else uses it (`releaseInviteAccount` in `src/lib/nominee-invite-server.ts`). Photos live in the `nominee-photos` bucket, resized server-side, publicly readable. Code scheme: numeric, 4 digits to start, no leading zero, generated server-side with a collision retry against the unique index, never organizer-chosen, never reused (`src/lib/nominee-code.ts`).
- **RoundEntry**: roundId, nomineeId, eventId, organizationId, voteCount (cached). Which nominees are in which round, and their frozen tally once the round closes. A nominee gets a round 1 entry when created, unless round 1 is already closed; entries for later rounds wait on #30. Built 2026-10-14 (`round_entries` table).

### Payments and votes
- **Payment**: id, organizationId, eventId, roundId, nomineeId, channel (`web` | `ussd`), purpose (`vote` | `ticket`), payerPhone, payerEmail (tickets), payerName (tickets), tierId (tickets), network, quantity, amount, platformFee, organizerNet, provider, providerReference (unique), status (`pending` | `success` | `failed` | `refunded`), createdAt, confirmedAt, rawCallback (JSON). Built 2026-10-14 (`payments` table, web votes only). `providerReference` starts as `local_<id>` and is replaced by the provider's reference once `initiate` answers.
- **Vote**: id, paymentId (nullable), nomineeId, eventId, roundId, organizationId, quantity, **source** (`paid` | `free`), grantedBy (userId, required when source = free), reason (free only), createdAt
  - Paid votes: one Vote row per successful payment, with a quantity; `paymentId` is required and the Vote's id is `v_<paymentId>`, so a replayed confirmation collides instead of double counting. Built 2026-10-14 (`votes` table).
  - Free votes: `paymentId` is null, `source = free`, `grantedBy` is set, and an AuditLog entry is written in the same transaction. The vote id is `fv_<hash(organizationId, idempotencyKey)>`, so a repeated submission grants once. Built 2026-10-14 (`src/lib/free-votes-server.ts`).
  - Tallies are always computed per round and can be split by source.
- **UssdSession**: id, sessionId (from the aggregator, unique), phone (from the aggregator, never typed), network, state (JSON, the menu state), lastStep, status (`active` | `released`), expiresAt (3 minutes after the last step). Built 2026-10-14 (`ussd_sessions` table).

### Ticketing
- **TicketTier**: id, eventId, organizationId, name, price (pesewas), quantityAvailable (null = unlimited), quantitySold (cached counter), salesStart, salesEnd, status (`active` | `hidden`), order. Built 2026-10-14 (`ticket_tiers` table).
- **Ticket**: id (`tk_<paymentId>_<n>`, so a replayed confirmation collides), tierId, eventId, organizationId, paymentId, buyerName, buyerPhone, buyerEmail, qrToken (signed, unique), status (`valid` | `used` | `cancelled`), usedAt, scannedBy, emailSentAt. Built 2026-10-14 (`tickets` table).
- **TicketScan**: id = the ticket id, organizationId, eventId, ticketId, scannedBy. Created inside the scan transaction; its id collision is what makes `valid → used` atomic. Built 2026-10-14 (`ticket_scans` table).
  - The QR code encodes a signed token (e.g. HMAC of ticket id), never the bare id, so tickets can't be forged by guessing ids.

### Money out
- **LedgerEntry**: organizationId, type (`vote_credit` | `ticket_credit` | `payout_debit` | `adjustment`), amount (pesewas, debits negative), paymentId (unique where set, id `l_<paymentId>`), note. The wallet balance is the sum; available = credits + debits − payouts still requested or approved (`src/lib/ledger-server.ts`). Built 2026-10-14 (`ledger_entries` table).
- **Payout**: id (`po_<hash(organizationId, idempotencyKey)>`), organizationId, amount (pesewas), destinationKind (`momo` | `bank`), destination (JSON), status (`requested` | `approved` | `paid` | `rejected`), requestedBy, decidedBy, note, decidedAt, paidAt. Built 2026-10-14 (`payouts` table). A request reserves its amount against the available balance; `paid` writes the `payout_debit` ledger row (id `l_po_<id>`, `paymentId = payout:<id>`) in the same transaction and re-checks that settled credits cover it, so money out never exceeds money in.
- **PayoutLock**: id = organizationId, organizationId, holder, expiresAt. Serializes marking payouts paid per organization, so two concurrent `paid` transitions can't both pass the settled-credits check: a second holder collides on creation, and an expired lock (a crashed holder) is reclaimed once (`withPayoutLock` in `src/lib/payouts-server.ts`). Built 2026-10-14 (`payout_locks` table).

### Flyer engine
- **Font**: id, organizationId (null = platform-wide), family, fileId, weight, style. TTF/OTF only. Built 2026-10-14 (`fonts` table, `fonts` bucket).
- **FlyerTemplate**: id, organizationId, eventId, categoryId (optional override), name, width, height (from the background image), backgroundFileId, canvasJson (our slot model, see FLYER_ENGINE.md), status (`draft` | `published`), version (bumped on publish). Built 2026-10-14 (`flyer_templates` table, `flyer-templates` bucket). Platform library: later.
- **TemplateSlot**: lives inside `FlyerTemplate.canvasJson` (decided during implementation, 2026-10-14): type (`photo` | `text`), binding (`nominee.name` | `nominee.code` | `category.name` | `event.title` | `ussd.instruction` | `custom`), geometry (x, y, w, h, rotation) and style (fontFamily, fontWeight, fontSize, minFontSize, color, align, uppercase, maxLines; shape and radius for the photo).
- **GeneratedFlyer**: id, organizationId, nomineeId (unique), templateId, templateVersion, fileId, sourceHash (of every input; regenerate only when it changes), createdAt. Built 2026-10-14 (`generated_flyers` table, `flyers` bucket).

### Operations
- **AuditLog**: id, actorId, organizationId, action, target, metadata, createdAt. Written for event status changes (`event.<status>`), round open and close (`round.open`, `round.close`), morale candidate creation (`nominee.create_morale`), free-vote grants (`vote.grant_free`), nominee edits, photo uploads, invites and claims (`nominee.update`, `nominee.photo`, `nominee.invite`, `nominee.claim`), team invites and changes (`team.invite`, `team.invite_accept`, `team.invite_resend`, `team.invite_revoke`, `team.role_change`, `team.remove`), payment anomalies (`vote.late`, `ticket.oversold`, `payment.amount_mismatch`), payout requests, cancellations, decisions and payments (`payout.request`, `payout.cancel`, `payout.<decision>`, `payout.paid`), and super admin changes to an organization (`organization.suspend`, `organization.reactivate`, `organization.settings`, with before, after and the reason). Built 2026-10-14 (`audit_logs` table).

- **RateLimit**: id (a hash of the limited key and the window, so no phone number or IP is stored), count, expiresAt. One row per key per window; see `src/lib/rate-limit.ts`. Built 2026-11-12 (`rate_limits` table). Not tenant-owned.

## Relationships

Organization 1–* Event 1–* Category 1–* Nominee
Event 1–* Round 1–* RoundEntry *–1 Nominee
Nominee 1–* Payment 1–1 Vote (paid)
Nominee 1–* Vote (free, no Payment)
Event 1–* TicketTier 1–* Ticket *–1 Payment
Organization 1–* FlyerTemplate 1–* TemplateSlot (embedded in `canvasJson`, not a table)
Nominee 1–1 GeneratedFlyer (the current flyer; regenerated in place)

## Integrity constraints

- `Payment.providerReference` has a unique index, which makes callbacks idempotent.
- Paid votes are created only inside the same Appwrite database transaction (`createTransaction` → operations → commit) that moves a Payment to `success`.
- Free votes require `grantedBy`, are only creatable by organizer admins or super admins, and always write an AuditLog entry in the same transaction.
- A Vote's `roundId` must be the event's currently live round at the time of creation.
- Once a Round is `closed`, its Votes and RoundEntry tallies are immutable.
- The cumulative report (`src/lib/report/`) sums Vote rows per nominee per round and then across rounds; each vote belongs to one round, so nothing is counted twice, and the cached RoundEntry tallies are not used for it.
- `Ticket.qrToken` is unique and signed (`<id>.<HMAC-SHA256(TICKET_SECRET, id)>`); scanning is an atomic `valid → used` transition (the `ticket_scans` row with the ticket's id) so a ticket can't be used twice. Payment ids are not secrets (Appwrite ids are a timestamp plus 28 non-cryptographic random bits, and every ticket id contains its payment id), so the buyer's page lists a purchase's tickets only with the access key `HMAC-SHA256(TICKET_SECRET, "payment-access:" + paymentId)` that the initiate call returns, sent as `X-Payment-Key` (`buyerTickets` in `src/lib/tickets/purchase-server.ts`). Payment `roundId` is null for ticket payments; `tierId` and `payerName` were added for them.
- `Nominee.code` has a platform-wide unique index (not per event or per organization), so a code entered over USSD resolves to exactly one nominee without an event code.
