# Decisions Log

Format: date, decision, reasoning.

| Date | Decision | Reasoning |
|---|---|---|
| 2026-10-09 | Multi-tenant platform: many organizers, each with their own workspace and campaigns | Serve every faculty, department and group, not one client |
| 2026-10-09 | Initial market: KNUST pageants, dinner awards and similar events | Founder's network plus a sales partner with faculty connections |
| 2026-10-09 | Voting is paid | Standard model in this market; this is the revenue source |
| 2026-10-09 | Two independent voting paths, web and USSD only, feeding one tally | Reach voters without smartphones or data; web for browsing |
| 2026-10-09 | Each nominee has a short code used on both paths | Lets USSD-only voters vote without the website |
| 2026-10-09 | Built-in flyer engine is the main differentiator | No competitor offers it; removes a per-nominee designer cost |
| 2026-10-09 | Flyer engine is a lightweight template personalizer (Photopea-inspired, not a clone) with custom font upload | Delivers the benefit without taking on a years-long editor project |
| 2026-10-09 | VotyHive is the main benchmark for features and UX | Strong interface; built by a close friend |
| 2026-10-13 | Development will be done with Claude Code using these docs | — |
| 2026-10-14 | Nominees get a self-service portal (email with credentials, upload photo, download flyer) | Sales partner's requirement; takes profile collection off the organizer |
| 2026-10-14 | Events can optionally run in rounds, each starting from zero, with a cumulative PDF report | Sales partner's requirement; matches how pageants are run |
| 2026-10-14 | Ticketing is in scope: web and USSD purchase, QR code by email, scanned at the door | Sales partner's requirement; competitors all offer it |
| 2026-10-14 | Dashboard shows paid votes, free votes, combined total and the revenue split by percentage | Sales partner's requirement |
| 2026-10-14 | Morale candidates and bulk free votes will be built, behind switches and with audit safeguards, while the founder reviews how to make the feature legitimate | Sales partner's requirement; legitimacy concern recorded in OPEN_QUESTIONS #29 |
| 2026-10-14 | Organizer admins can nominate contestants directly | Sales partner's requirement |
