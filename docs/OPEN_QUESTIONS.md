# Open Questions

Claude Code: **do not settle these on your own.** Ask, or build behind a placeholder and flag it. When one is settled, move it to `DECISIONS.md`.

## Product and business
1. **Product name** and domain.
2. ~~**Pricing model:** commission only, subscription plus commission, or per-event fee? Commission rate?~~ Settled 2026-10-14: commission only, 10% of gross. See DECISIONS.
3. ~~**Payout flow:** manual approval or automatic? How often? Minimum amount? To MoMo, bank or both?~~ Settled 2026-11-12: manual approval on the organizer's request, MoMo or bank, minimum set per deployment. See DECISIONS.
4. ~~Ticketing: in the MVP or later?~~ Settled 14 Oct: in scope. See DECISIONS.
5. **Public nominations** (the public nominates candidates before voting): MVP or later?
6. **WhatsApp or Telegram voting:** later?
7. **Free voting** (no payment) for some events?
8. **Card payments** in addition to MoMo?
9. ~~**Organizer onboarding:** self-serve sign-up, or approval by the super admin first?~~ Settled 2026-10-14: self-serve, organizations start `active`. See DECISIONS.
10. **Partner arrangement** with the sales partner (revenue share, access level in the system).

## USSD and payments
11. ~~**Aggregator:** Hubtel, Nsano, Arkesel or another? Costs, setup time, dedicated or shared shortcode.~~ Settled 2026-10-14: Hubtel, for payments and USSD. Costs and shortcode type are confirmed during onboarding. See DECISIONS.
12. ~~**Nominee code scheme:** platform-wide unique codes, or event code plus nominee code?~~ Settled 2026-10-14: platform-wide unique codes. See DECISIONS.
13. **Late payments** after an event closes: honour them or refund?
14. **SMS receipts** to voters: yes or no? Which provider?
15. **Refunds and disputes** process.
16. **Minimum and maximum votes per transaction.**

## Flyer engine
17. **Who builds templates:** our designers, the organizer's designer, or both? Is there a platform template library?
18. **Organizer editing freedom** in the browser editor.
19. **PSD import:** how far should it go, and is it in the MVP?
20. **Flyer generation:** free for everyone or a paid feature?
21. **Output sizes:** WhatsApp Status, square post, print?
22. **Leaderboard flyers:** yes or no?

## Technical
23. ~~**Tech stack confirmation** (Next.js + Postgres + Prisma proposed). Alternatives include Appwrite as the backend.~~ Settled 2026-10-14: mirror pickLT (Next.js 15 + Appwrite). See DECISIONS and ARCHITECTURE.
24. ~~**Hosting.** Object storage is settled (Appwrite Storage, with #23). Still open: where the Next.js app runs (pickLT uses Vercel) and which Appwrite Cloud region or self-hosted instance.~~ Settled 2026-10-14: Vercel and Appwrite Cloud Frankfurt. See DECISIONS. Note: Vercel functions have no fixed outbound IP by default, which Hubtel's status API allowlist needs; see `docs/HUBTEL_SMOKE_TEST.md`.
25. **Subdomains per organizer**, or slug paths only at first?
26. **Results visibility defaults** and the real-time approach. *Defaults settled 2026-11-12: no default, the organizer chooses at creation. See DECISIONS. Still open: the real-time approach.*
27. **Fraud controls** beyond payment (rate limits, flagging unusual spikes).
28. **Data protection:** voter phone number retention and consent (Ghana Data Protection Act 843). *Partly settled 2026-11-12: buyer phone numbers are masked to the last three digits everywhere except for owners and admins on the event page (the door scanner, the ticket page, and every other role, designers included), and an invite's unused account is deleted when the nominee's email changes. See DECISIONS. Still open: retention and consent.*

## Added 14 Oct 2026 (from the sales partner's voice note)
29. ~~**Morale candidates and free votes: legitimacy.** As requested, admins can plant candidates and grant bulk free votes to make categories look competitive. The founder is researching how to make this legitimate (disclosure to voters? labelled as "free votes" publicly? limits? consent from real nominees?). Until settled, the feature ships behind switches with the safeguards in PRD 5.4a. **Claude Code: do not loosen those safeguards, and do not design public results pages that hide the paid/free distinction without an explicit decision here.**~~ Settled 2026-10-14: ship with public disclosure. See DECISIONS.
30. **Rounds:** who decides which nominees advance (manual pick, top N, or threshold)? Can a nominee be added mid-event? Does the price per vote change per round?
31. **Ticket delivery over USSD:** QR link by SMS to the paying number, or ask for email in the USSD menu, or both?
32. **Transactional email provider** for nominee credentials and ticket QR codes (e.g. Resend, Postmark, SES). SMS provider if #31 needs it.
33. **Nominee portal scope:** can nominees edit their profile after the flyer is generated (triggering a regeneration)? Can they see their live vote count?
34. ~~**Ticket scanning:** a web page for scanner staff on their phones, or a small PWA with camera access? Offline tolerance?~~ Settled 2026-11-12: a web page, camera or paste, online only. See DECISIONS.
35. ~~**Cumulative report format:** per nominee, per category, both? Include paid/free split? Branded with organizer logo?~~ Settled 2026-11-12: all of them. See DECISIONS.
36. **Who absorbs Hubtel's and the MoMo networks' charges:** out of the platform's 10%, or deducted from the gross before the 90/10 split? (Raised when #2 was settled; the code currently splits the gross, so the platform absorbs them.)
