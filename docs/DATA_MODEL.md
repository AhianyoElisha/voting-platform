# Data Model (Draft)

Entities are **Appwrite Database collections** (decided 2026-10-14, see `ARCHITECTURE.md`; the Appwrite CLI now calls them *tables* and *columns*, which is how `appwrite.config.json` spells them). Money is stored as integer **pesewas**. Timestamps are stored in UTC. All tenant-owned collections carry an indexed `organizationId`. JSON-shaped fields (`brandColors`, `state`, `rawCallback`, `canvasJson`, `metadata`) are string attributes holding serialized JSON, since Appwrite has no JSON attribute type.

## Entities

### Platform level
- **User**: id (= the Appwrite Auth user id), fullName, email, phone, isSuperAdmin, createdAt. Passwords live in Appwrite Auth, not here. Built 2026-10-14 (`users` table).
- **Organization** (tenant): id, name, slug (platform-wide unique index), logoUrl, brandColors, status (`active` | `suspended`; new organizations start `active`, decided 2026-10-14 (#9); only the super admin suspends), commissionRate (overrides the platform default; unit and default wait on #2, so it is null for now), moraleCandidatesEnabled (per-organization switch, super admin only, default false), createdAt. Built 2026-10-14 (`organizations` table).
- **Membership**: userId, organizationId, role (`owner` | `admin` | `staff` | `designer` | `scanner`). Unique on (userId, organizationId). The user who creates an organization is its `owner`. Built 2026-10-14 (`memberships` table).
  - Nominees also have a User row (for the nominee portal) but no Membership; their access is through `Nominee.userId` and is limited to their own record.

### Campaigns
- **Event**: id, organizationId, title, slug (unique within the organization), description, coverImageUrl, eventCode (short, for the USSD ticket branch only; voting uses the nominee code alone; null until ticketing), votePrice (pesewas), startsAt, endsAt, status (`draft` | `scheduled` | `live` | `paused` | `closed`), resultsVisibility (`hidden` | `ranking` | `percentage` | `count`; the organizer chooses at creation, no default, #26), resultsPublishedAt, moraleCandidatesEnabled (per-event switch, PRD 5.4a). Built 2026-10-14 (`events` table).
- **Round**: id, eventId, organizationId, number, name, startsAt, endsAt, status (`pending` | `live` | `closed`), closedAt. Every event has at least one round; events "without rounds" have exactly one. Round 1 is created with the event. At most one live round per event; `closed` is terminal. Built 2026-10-14 (`rounds` table).
- **Category**: id, eventId, organizationId, name, order. Built 2026-10-14 (`categories` table).
- **Nominee**: id, categoryId, eventId, organizationId, name, code (short, unique across the whole platform; decided 2026-10-14, see DECISIONS), photoUrl, bio, status (`active` | `withdrawn`), **isMorale** (bool, default false), userId (nullable; the nominee's portal login), profileCompletedAt, email, inviteTokenHash, inviteExpiresAt, inviteSentAt, claimedAt. Built 2026-10-14 (`nominees` table). Portal access: the invite creates the Auth user and a one-time claim link (only the token's SHA-256 is stored); the nominee sets a password on the claim page; every portal read and write checks `userId` against the session (`src/lib/portal-server.ts`). Photos live in the `nominee-photos` bucket, resized server-side, publicly readable. Code scheme: numeric, 4 digits to start, no leading zero, generated server-side with a collision retry against the unique index, never organizer-chosen, never reused (`src/lib/nominee-code.ts`).
- **RoundEntry**: roundId, nomineeId, eventId, organizationId, voteCount (cached). Which nominees are in which round, and their frozen tally once the round closes. A nominee gets a round 1 entry when created, unless round 1 is already closed; entries for later rounds wait on #30. Built 2026-10-14 (`round_entries` table).

### Payments and votes
- **Payment**: id, organizationId, eventId, roundId, nomineeId, channel (`web` | `ussd`), purpose (`vote` | `ticket`), payerPhone, payerEmail (tickets), network, quantity, amount, platformFee, organizerNet, provider, providerReference (unique), status (`pending` | `success` | `failed` | `refunded`), createdAt, confirmedAt, rawCallback (JSON). Built 2026-10-14 (`payments` table, web votes only). `providerReference` starts as `local_<id>` and is replaced by the provider's reference once `initiate` answers.
- **Vote**: id, paymentId (nullable), nomineeId, eventId, roundId, organizationId, quantity, **source** (`paid` | `free`), grantedBy (userId, required when source = free), reason (free only), createdAt
  - Paid votes: one Vote row per successful payment, with a quantity; `paymentId` is required and the Vote's id is `v_<paymentId>`, so a replayed confirmation collides instead of double counting. Built 2026-10-14 (`votes` table).
  - Free votes: `paymentId` is null, `source = free`, `grantedBy` is set, and an AuditLog entry is written in the same transaction.
  - Tallies are always computed per round and can be split by source.
- **UssdSession**: id, sessionId (from aggregator), phone, network, state (JSON), lastStep, createdAt, updatedAt

### Ticketing
- **TicketTier**: id, eventId, organizationId, name, price (pesewas), quantityAvailable, salesStart, salesEnd
- **Ticket**: id, tierId, eventId, organizationId, paymentId, buyerName, buyerPhone, buyerEmail, qrToken (signed, unique), status (`valid` | `used` | `cancelled`), usedAt, scannedBy, emailSentAt
  - The QR code encodes a signed token (e.g. HMAC of ticket id), never the bare id, so tickets can't be forged by guessing ids.

### Money out
- **LedgerEntry**: organizationId, type (`vote_credit` | `ticket_credit` | `payout_debit` | `adjustment`), amount (pesewas, debits negative), paymentId (unique where set, id `l_<paymentId>`), note. The wallet balance is the sum. Built 2026-10-14 (`ledger_entries` table).
- **Payout**: id, organizationId, amount, destination (MoMo number or bank), status (`requested` | `approved` | `paid` | `rejected`), requestedBy, approvedBy, timestamps

### Flyer engine
- **Font**: id, organizationId (null = platform-wide), family, fileUrl, weight, style
- **FlyerTemplate**: id, organizationId (null = platform library), eventId? / categoryId?, name, width, height, backgroundUrl, canvasJson (Fabric serialization), status
- **TemplateSlot**: id, templateId, type (`photo` | `text`), binding (`nominee.name` | `nominee.code` | `category.name` | `event.title` | `ussd.instruction` | `custom`), plus geometry and style (x, y, w, h, rotation, fontId, size, color, align, mask/shape)
  - Slots could instead live only inside `canvasJson` as custom properties. Decide during implementation.
- **GeneratedFlyer**: id, nomineeId, templateId, templateVersion, imageUrl, format/size variant, createdAt

### Operations
- **AuditLog**: id, actorId, organizationId, action, target, metadata, createdAt. Written for event status changes, round open and close, and morale candidate creation; later for free votes and payouts. Built 2026-10-14 (`audit_logs` table).

## Relationships

Organization 1–* Event 1–* Category 1–* Nominee
Event 1–* Round 1–* RoundEntry *–1 Nominee
Nominee 1–* Payment 1–1 Vote (paid)
Nominee 1–* Vote (free, no Payment)
Event 1–* TicketTier 1–* Ticket *–1 Payment
Organization 1–* FlyerTemplate 1–* TemplateSlot
Nominee 1–* GeneratedFlyer

## Integrity constraints

- `Payment.providerReference` has a unique index, which makes callbacks idempotent.
- Paid votes are created only inside the same Appwrite database transaction (`createTransaction` → operations → commit) that moves a Payment to `success`.
- Free votes require `grantedBy`, are only creatable by organizer admins or super admins, and always write an AuditLog entry in the same transaction.
- A Vote's `roundId` must be the event's currently live round at the time of creation.
- Once a Round is `closed`, its Votes and RoundEntry tallies are immutable.
- `Ticket.qrToken` is unique; scanning is an atomic `valid → used` transition so a ticket can't be used twice.
- `Nominee.code` has a platform-wide unique index (not per event or per organization), so a code entered over USSD resolves to exactly one nominee without an event code.
