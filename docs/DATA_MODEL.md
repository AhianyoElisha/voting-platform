# Data Model (Draft)

Entities are **Appwrite Database collections** (decided 2026-10-14, see `ARCHITECTURE.md`). Money is stored as integer **pesewas**. Timestamps are stored in UTC. All tenant-owned collections carry an indexed `organizationId`. JSON-shaped fields (`brandColors`, `state`, `rawCallback`, `canvasJson`, `metadata`) are string attributes holding serialized JSON, since Appwrite has no JSON attribute type.

## Entities

### Platform level
- **User**: id, name, email, phone, passwordHash, isSuperAdmin, createdAt
- **Organization** (tenant): id, name, slug, logoUrl, brandColors, status (pending/active/suspended), commissionRate (overrides default), createdAt
- **Membership**: userId, organizationId, role (`owner` | `admin` | `staff` | `designer` | `scanner`)
  - Nominees also have a User row (for the nominee portal) but no Membership; their access is through `Nominee.userId` and is limited to their own record.

### Campaigns
- **Event**: id, organizationId, title, slug, description, coverImageUrl, eventCode (short, for USSD), votePrice (pesewas), startsAt, endsAt, status (`draft` | `scheduled` | `live` | `paused` | `closed`), resultsVisibility (`hidden` | `ranking` | `percentage` | `count`), resultsPublishedAt
- **Round**: id, eventId, organizationId, number, name, startsAt, endsAt, status (`pending` | `live` | `closed`). Every event has at least one round; events "without rounds" have exactly one.
- **Category**: id, eventId, organizationId, name, order
- **Nominee**: id, categoryId, eventId, organizationId, name, code (short, unique within its scope; see OPEN_QUESTIONS), photoUrl, bio, status, **isMorale** (bool, default false), userId (nullable; the nominee's portal login), profileCompletedAt
- **RoundEntry**: roundId, nomineeId, voteCount (cached). Which nominees are in which round, and their frozen tally once the round closes.

### Payments and votes
- **Payment**: id, organizationId, eventId, roundId, nomineeId, channel (`web` | `ussd`), purpose (`vote` | `ticket`), payerPhone, payerEmail (tickets), network, quantity, amount, platformFee, organizerNet, provider, providerReference (unique), status (`pending` | `success` | `failed` | `refunded`), createdAt, confirmedAt, rawCallback (JSON)
- **Vote**: id, paymentId (nullable), nomineeId, eventId, roundId, organizationId, quantity, **source** (`paid` | `free`), grantedBy (userId, required when source = free), reason (free only), createdAt
  - Paid votes: one Vote row per successful payment, with a quantity; `paymentId` is required.
  - Free votes: `paymentId` is null, `source = free`, `grantedBy` is set, and an AuditLog entry is written in the same transaction.
  - Tallies are always computed per round and can be split by source.
- **UssdSession**: id, sessionId (from aggregator), phone, network, state (JSON), lastStep, createdAt, updatedAt

### Ticketing
- **TicketTier**: id, eventId, organizationId, name, price (pesewas), quantityAvailable, salesStart, salesEnd
- **Ticket**: id, tierId, eventId, organizationId, paymentId, buyerName, buyerPhone, buyerEmail, qrToken (signed, unique), status (`valid` | `used` | `cancelled`), usedAt, scannedBy, emailSentAt
  - The QR code encodes a signed token (e.g. HMAC of ticket id), never the bare id, so tickets can't be forged by guessing ids.

### Money out
- **Wallet / Ledger**: organizationId, entries (credit from vote, debit from payout, adjustments)
- **Payout**: id, organizationId, amount, destination (MoMo number or bank), status (`requested` | `approved` | `paid` | `rejected`), requestedBy, approvedBy, timestamps

### Flyer engine
- **Font**: id, organizationId (null = platform-wide), family, fileUrl, weight, style
- **FlyerTemplate**: id, organizationId (null = platform library), eventId? / categoryId?, name, width, height, backgroundUrl, canvasJson (Fabric serialization), status
- **TemplateSlot**: id, templateId, type (`photo` | `text`), binding (`nominee.name` | `nominee.code` | `category.name` | `event.title` | `ussd.instruction` | `custom`), plus geometry and style (x, y, w, h, rotation, fontId, size, color, align, mask/shape)
  - Slots could instead live only inside `canvasJson` as custom properties. Decide during implementation.
- **GeneratedFlyer**: id, nomineeId, templateId, templateVersion, imageUrl, format/size variant, createdAt

### Operations
- **AuditLog**: id, actorId, organizationId, action, target, metadata, createdAt

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
- Nominee code uniqueness is enforced by a unique index within the chosen scope.
