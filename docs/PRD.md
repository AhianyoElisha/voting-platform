# Product Requirements Document

Status: **Draft v0.2**, 14 Oct 2026. Several areas are still open; see `OPEN_QUESTIONS.md`.

Changelog: v0.2 adds requirements from the sales partner's voice note of 14 Oct 2026 (nominee portal, voting rounds, ticketing, dashboard figures, morale candidates, admin nominations).

## 1. Problem

Pageants, dinner awards and similar campus events at KNUST run paid public voting. Several platforms already offer this, but they all look the same: web voting, USSD and ticketing. Every organizer still has to **pay a graphic designer separately to make a flyer for each nominee** once nominees are confirmed. That is slow, costly and inconsistent, and it delays the start of campaigning.

## 2. Solution

A multi-tenant voting platform that matches the standard feature set (web and USSD paid voting, live results, organizer workspaces) and adds an **automatic flyer engine**. A designer makes one template per event or category. The platform then produces a personalized flyer for every nominee from their uploaded photo and details, with the voting code and USSD instructions included.

## 3. Market and go-to-market

- **Beachhead:** KNUST, covering faculties, departments, halls, associations and student groups running pageants and awards.
- **Distribution:** a partner who recently finished a term as an executive of the Faculty of Social Sciences has relationships across faculties and departments. He will be the main sales contact.
- **Pitch:** "The same voting everyone else offers, plus professional flyers for every nominee, generated instantly and at no extra cost."
- Later: other universities and general events in Ghana.

## 4. Users and roles

| Role | Description |
|---|---|
| **Super admin** | The platform owner. Manages organizers, fees, payouts, templates and disputes. Sees everything. |
| **Organizer admin** | Owns an organization workspace. Creates events, categories and nominees, and manages team members, flyers, results and payouts. |
| **Organizer staff** | Optional team members with limited permissions (exact permissions TBD). |
| **Designer** | Creates and maintains flyer templates. Could be in-house or belong to an organizer (open question). |
| **Nominee** | A contestant. Receives an email with login details once nominated, logs into a nominee portal, uploads their photo and details, and downloads their generated flyer. |
| **Voter** | Member of the public. No account needed. Votes on the web or over USSD and pays with mobile money (and possibly card). |
| **Ticket buyer** | Member of the public. Buys an event ticket on the web or over USSD and receives a QR code by email. |

## 5. Core features (MVP candidates)

### 5.1 Organizer workspace
- Sign up and create an organization. Self-serve: the workspace is active immediately, with no super-admin approval step (decided 2026-10-14, see DECISIONS). The super admin can suspend an organization later.
- Branded public page (logo, colours). Custom subdomain is an open question.
- Invite team members.

### 5.2 Events, categories and nominees
- Create an event (voting campaign) with start and end times and a price per vote.
- Add categories (e.g. "Miss Social Science", "Most Influential").
- Add nominees with a photo, name, category and optional bio.
- Each nominee gets a **short code that is unique across the whole platform**, used on both the web and USSD. A USSD voter enters only this code (decided 2026-10-14, see DECISIONS).
- Open, close, pause and publish events.
- The organizer admin can nominate contestants directly (no public nomination needed).

### 5.2a Nominee portal
- When a nominee is added, they receive an **email confirming the nomination** with their login credentials for the nominee portal. *Built 2026-10-14 as a one-time claim link: the nominee sets their own password on the claim page, so no password travels by email. Until an email provider is chosen (#32) the organizer gets the link to share directly.*
- In the portal the nominee completes their profile: photo upload, name as it should appear, bio and any other fields the organizer requires.
- As soon as the photo is uploaded, the platform **generates the nominee's flyer immediately**, and the nominee can download it from the portal.
- The nominee can see their own voting code and (if the organizer allows) their own vote count.

### 5.2b Voting rounds (optional per event)
- An organizer can run an event in **rounds** (e.g. round 1, round 2, final).
- When a round closes, its votes are **frozen and saved to that round**. The next round starts every nominee at **zero**.
- The organizer controls which nominees advance to the next round.
- After the final round, the organizer can generate a **cumulative report**: total votes per nominee across all rounds, per category, exportable as **PDF**.
- Events without rounds behave as a single round.

### 5.3 Voting: two independent paths, one tally
- **Web:** browse events, categories and nominees, see details, choose a number of votes, pay by MoMo, and the vote is counted once payment is confirmed.
- **USSD:** dial the shortcode, enter or select the nominee code, enter the number of votes, approve the MoMo prompt, and the vote is counted once payment is confirmed. No smartphone or data needed.
- Both paths write to the same vote records.

### 5.4 Results and organizer dashboard
- Live tally for organizers (for the active round when rounds are in use).
- Organizer chooses what the public sees: nothing, rankings, percentages or exact counts, and when.
- The organizer dashboard shows, per event:
  - total **paid** votes
  - total **free (non-paid)** votes
  - combined total
  - gross revenue, the platform's percentage share, and the organizer's (faculty or department's) percentage share, with the split configurable per organization

### 5.4a Morale candidates and free votes  ⚠ pending legitimacy review
*Requested by the sales partner. The founder is reviewing how to make this legitimate before launch; see OPEN_QUESTIONS #29. Build it behind a per-event switch so it can be disabled or constrained without code changes.*

- The organizer admin can add **morale candidates** to any category: nominees created by the admin to make a category look competitive and encourage real nominees' supporters to buy votes.
- The admin can cast **free votes** in bulk for any nominee (e.g. 1,000 at once). These are recorded as free votes, never as paid.
- Free votes count toward the "free votes" figure on the dashboard and toward the displayed tally.
- Required safeguards regardless of the final policy decision:
  - Morale candidates are flagged as such in the database (`isMorale`) and in all admin views and reports.
  - Every free-vote grant is written to the audit log with the actor, nominee, quantity and reason.
  - Free votes never appear in revenue figures.
  - A platform-level setting lets the super admin disable morale candidates or free votes for an organization or the whole platform.
  - An event-level setting controls whether free votes are shown separately from paid votes on the public results page (default to be decided in the review).

### 5.4b Ticketing
- Organizers can sell **event tickets** alongside voting, with one or more ticket tiers.
- Buyers purchase on the **web** (event page) or over **USSD** (a "Buy ticket" branch on the same shortcode), paying with mobile money.
- On confirmed payment the buyer receives an **email with a QR code**. Staff scan the QR code at the entrance; no serial number or ID check is needed.
- Scanning marks the ticket as used so it cannot be reused.
- Ticket revenue is split like vote revenue (platform share and organizer share).

### 5.5 Flyer engine (differentiator)
- Upload a template (designed in Photoshop or Photopea and exported).
- Lightweight browser editor to define **slots**: photo frame, name, category, nominee code, USSD string, and event name or date.
- Upload **custom fonts** so text matches the original design.
- Generate flyers automatically for every nominee, individually or in bulk.
- Download or share flyers (sized for WhatsApp Status and social media).
- Full detail in `FLYER_ENGINE.md`.

### 5.6 Payments and payouts
- Votes are paid with mobile money via Hubtel (decided 2026-10-14, see DECISIONS). Hubtel also provides the USSD shortcode.
- The platform takes a commission; the rest goes to the organizer's balance.
- Organizers request payouts; the super admin approves them (flow TBD).

### 5.7 Super admin console
- Manage organizations, events, fees, templates and payouts.
- View transactions and audit logs, and handle disputes and refunds.

## 6. Ideas proposed, not yet agreed

These came up in discussion and still need a yes or no (see OPEN_QUESTIONS):
- WhatsApp Status-sized flyers with the voting code and USSD string included.
- Auto-generated "leaderboard flyers" (e.g. "Top 3 in Miss Social Science") to keep campaigns going.
- Commission-only pricing with no monthly subscription, to suit student groups.
- Campus-native setup: KNUST faculties, departments and halls preloaded.
- Public nominations, and WhatsApp or Telegram voting (competitors offer these). Ticketing moved to core features in v0.2.

## 7. Non-functional requirements

- **Integrity:** no paid vote without a confirmed payment, idempotent callback handling, and audit logs. Free votes are admin-only and always audited.
- **Email delivery:** nominee credentials and ticket QR codes go out by email, so a reliable transactional email provider is required (TBD).
- **Tenant isolation:** organizers can never see each other's data.
- **Performance:** public pages stay fast on 3G and low-end Android phones. The system handles voting spikes near deadlines.
- **Availability:** USSD and payment callbacks must be highly reliable, because a missed callback means a paid vote is lost.
- **Compliance:** Ghana Data Protection Act (Act 843) for voter phone numbers. Possibly also aggregator and telecom rules for USSD.
- **Security:** callback signature verification, rate limiting, and role-based access.

## 8. Out of scope (for now)

- A full Photoshop or Photopea clone inside the platform.
- Free or anonymous identity-verified elections (e.g. SRC elections). These are a different product.
- Native mobile apps.

## 9. Success metrics (draft)

- Number of KNUST organizations onboarded in the first semester.
- Time from nominees confirmed to flyers in hand (target: minutes, not days).
- Paid votes processed and failed or lost payment rate (target: near zero).
- Organizer repeat rate across events.
