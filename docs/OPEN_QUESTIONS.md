# Open Questions

Claude Code: **do not settle these on your own.** Ask, or build behind a placeholder and flag it. When one is settled, move it to `DECISIONS.md`.

## Product and business
1. **Product name** and domain. *Still open (asked 2026-11-13: not decided yet). `voteapp` stays as the placeholder.*
2. ~~**Pricing model:** commission only, subscription plus commission, or per-event fee? Commission rate?~~ Settled 2026-10-14: commission only, 10% of gross. See DECISIONS.
3. ~~**Payout flow:** manual approval or automatic? How often? Minimum amount? To MoMo, bank or both?~~ Settled 2026-11-12: manual approval on the organizer's request, MoMo or bank, minimum set per deployment. See DECISIONS.
4. ~~Ticketing: in the MVP or later?~~ Settled 14 Oct: in scope. See DECISIONS.
5. ~~**Public nominations** (the public nominates candidates before voting): MVP or later?~~ Settled 2026-11-13: build for launch, with the organizer approving nominations. See DECISIONS.
6. ~~**WhatsApp or Telegram voting:** later?~~ Settled 2026-11-13: no; web and USSD only. See DECISIONS.
7. ~~**Free voting** (no payment) for some events?~~ Settled 2026-11-13: no; public voting is always paid. See DECISIONS.
8. ~~**Card payments** in addition to MoMo?~~ Settled 2026-11-13: mobile money only for launch; cards later. See DECISIONS.
9. ~~**Organizer onboarding:** self-serve sign-up, or approval by the super admin first?~~ Settled 2026-10-14: self-serve, organizations start `active`. See DECISIONS.
10. ~~**Partner arrangement** with the sales partner (revenue share, access level in the system).~~ Settled 2026-11-13: no special access in the system; his revenue share is agreed outside the platform. See DECISIONS.

## USSD and payments
11. ~~**Aggregator:** Hubtel, Nsano, Arkesel or another? Costs, setup time, dedicated or shared shortcode.~~ Settled 2026-10-14: Hubtel, for payments and USSD. Costs and shortcode type are confirmed during onboarding. Amended 2026-11-12: payments on Paystack, Hubtel for USSD only. See DECISIONS.
12. ~~**Nominee code scheme:** platform-wide unique codes, or event code plus nominee code?~~ Settled 2026-10-14: platform-wide unique codes. See DECISIONS.
13. ~~**Late payments** after an event closes: honour them or refund?~~ Settled 2026-11-12: honour them. See DECISIONS.
14. ~~**SMS receipts** to voters: yes or no? Which provider?~~ Settled 2026-11-12: no SMS receipts. See DECISIONS. (The SMS provider question moves to #31, which needs one.)
15. ~~**Refunds and disputes** process.~~ Settled 2026-11-12: manual, by the super admin. See DECISIONS.
16. ~~**Minimum and maximum votes per transaction.**~~ Settled 2026-11-13: minimum 1 vote; maximum set by a money cap per payment, a platform setting that defaults to GHS 2,000. See DECISIONS.

## Flyer engine
17. ~~**Who builds templates:** our designers, the organizer's designer, or both? Is there a platform template library?~~ Settled: fonts on 2026-11-12 (Google Fonts shared, uploads private); templates on 2026-11-13 (each organization builds its own, plus a platform library to copy from). See DECISIONS.
18. ~~**Organizer editing freedom** in the browser editor.~~ Settled 2026-11-13: as built, a slot placer with no drawing or decoration tools. See DECISIONS.
19. ~~**PSD import:** how far should it go, and is it in the MVP?~~ Settled 2026-11-12: automatic slots from named layers. See DECISIONS.
20. ~~**Flyer generation:** free for everyone or a paid feature?~~ Settled 2026-11-13: free for everyone. See DECISIONS.
21. ~~**Output sizes:** WhatsApp Status, square post, print?~~ Settled 2026-11-13: one flyer at the template's own size. See DECISIONS.
22. ~~**Leaderboard flyers:** yes or no?~~ Settled 2026-11-13: yes, but later; not built for launch. See DECISIONS.

## Technical
23. ~~**Tech stack confirmation** (Next.js + Postgres + Prisma proposed). Alternatives include Appwrite as the backend.~~ Settled 2026-10-14: mirror pickLT (Next.js 15 + Appwrite). See DECISIONS and ARCHITECTURE.
24. ~~**Hosting.** Object storage is settled (Appwrite Storage, with #23). Still open: where the Next.js app runs (pickLT uses Vercel) and which Appwrite Cloud region or self-hosted instance.~~ Settled 2026-10-14: Vercel and Appwrite Cloud Frankfurt. See DECISIONS. Note: Vercel functions have no fixed outbound IP by default, which Hubtel's status API allowlist needed; payments moved to Paystack on 2026-11-12, which needs none.
25. ~~**Subdomains per organizer**, or slug paths only at first?~~ Settled 2026-11-13: slug paths for launch; subdomains later, with the paths still working. See DECISIONS.
26. ~~**Results visibility defaults** and the real-time approach.~~ Settled: defaults on 2026-11-12 (no default, the organizer chooses at creation); the real-time approach on 2026-11-13 (pages re-fetch results about every 30 seconds). See DECISIONS.
27. ~~**Fraud controls** beyond payment (rate limits, flagging unusual spikes).~~ Settled 2026-11-13: the rate limits as built are final and there is no spike flagging (per IP 20/min on vote and ticket initiation and OTP, per phone 6 initiations/min across web and USSD, 5 OTP tries per payment per 15 min, USSD 40 steps/min per phone, claim 10/min per IP, team accept 10/min per user). See DECISIONS.
28. ~~**Data protection:** voter phone number retention and consent (Ghana Data Protection Act 843).~~ Settled: masking on 2026-11-12; retention (90 days after the event closes) and consent (a notice at payment with a privacy policy link, no checkbox) on 2026-11-13. See DECISIONS.

## Added 14 Oct 2026 (from the sales partner's voice note)
29. ~~**Morale candidates and free votes: legitimacy.** As requested, admins can plant candidates and grant bulk free votes to make categories look competitive. The founder is researching how to make this legitimate (disclosure to voters? labelled as "free votes" publicly? limits? consent from real nominees?). Until settled, the feature ships behind switches with the safeguards in PRD 5.4a. **Claude Code: do not loosen those safeguards, and do not design public results pages that hide the paid/free distinction without an explicit decision here.**~~ Settled 2026-10-14: ship with public disclosure. See DECISIONS.
30. ~~**Rounds:** who decides which nominees advance (manual pick, top N, or threshold)? Can a nominee be added mid-event? Does the price per vote change per round?~~ Settled 2026-11-12: the organizer picks by hand; new nominees can join the next round; the price can differ per round. See DECISIONS.
31. ~~**Ticket delivery over USSD:**~~ ~~QR link by SMS to the paying number, or ask for email in the USSD menu, or both?~~ *Delivery settled 2026-11-12: a link to the ticket page by SMS to the paying number; no email asked in USSD. See DECISIONS. Provider settled 2026-11-13: Hubtel SMS.*
32. ~~**Transactional email provider** for nominee credentials and ticket QR codes (e.g. Resend, Postmark, SES).~~ Settled 2026-11-12: Resend. See DECISIONS. The SMS provider, if #31 or #14 needs one, is still open there.
33. ~~**Nominee portal scope:** can nominees edit their profile after the flyer is generated (triggering a regeneration)? Can they see their live vote count?~~ Settled 2026-11-13: nominees edit freely until the event closes; their own result follows the public results mode. See DECISIONS.
34. ~~**Ticket scanning:** a web page for scanner staff on their phones, or a small PWA with camera access? Offline tolerance?~~ Settled 2026-11-12: a web page, camera or paste, online only. See DECISIONS.
35. ~~**Cumulative report format:** per nominee, per category, both? Include paid/free split? Branded with organizer logo?~~ Settled 2026-11-12: all of them. See DECISIONS.
36. ~~**Who absorbs the payment provider's (Paystack's) and the MoMo networks' charges:** out of the platform's 10%, or deducted from the gross before the 90/10 split? (Raised when #2 was settled; the code currently splits the gross, so the platform absorbs them.)~~ Settled 2026-11-13: the charges come off the gross first, then the remainder is split 90/10. See DECISIONS. The charge is the fee Paystack reports for each payment.
