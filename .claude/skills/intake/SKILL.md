---
name: intake
description: Turn new requirements from the sales partner or a client — a transcript, voice-note text, meeting notes, a pasted message — into doc updates: PRD changes, data model changes, new open questions and decisions, with a changelog and the source saved. Usage: /intake <paste the notes, or give a file path>
---

# /intake

New requirements arrive informally. This skill gets them into the docs the same way every time, so nothing lives only in someone's head or a chat thread.

## Steps

1. Read the input. If it's a file path, read the file. If it's audio, say that transcription isn't handled here and ask for the text.
2. Save the raw source to `docs/sources/<YYYY-MM-DD>-<short-slug>.md` with a one-line header saying who it's from and how it was captured. Quote it verbatim (lightly cleaned for readability if it's a transcript; note any garbled words you've interpreted).
3. Read `docs/PRD.md`, `docs/DATA_MODEL.md`, `docs/OPEN_QUESTIONS.md`, `docs/DECISIONS.md` and `CLAUDE.md`.
4. Extract each distinct requirement. For each one classify it:
   - **New feature** → draft a PRD section (or addition to an existing one) and the data model changes.
   - **Change to an existing feature** → the specific PRD/data model edits.
   - **Settles an open question** → a `DECISIONS.md` row; strike the question.
   - **Raises a question** → a new numbered item in `OPEN_QUESTIONS.md`.
   - **Concern** → anything that looks legally, ethically or reputationally risky (deception of voters, hidden fees, data handling, anything that conflicts with "fraud protection" or "transparent results"). Don't silently fold these in. Flag them, put them in the PRD with a "pending review" marker and required safeguards, and add an open question. The existing handling of morale candidates (PRD 5.4a, OPEN_QUESTIONS #29) is the pattern.
5. Show the developer the list of extracted requirements with your classification **before** editing any doc, and ask for corrections. Transcripts mishear things; confirm interpretations.
6. On approval, apply the edits. Bump the PRD version and add a changelog line naming the source. Update `CLAUDE.md` if any new rule is needed. Update `USSD_AND_PAYMENTS.md` or `FLYER_ENGINE.md` if touched.
7. Rebuild any cross-references by number.

## Output

Step 5: a numbered list of requirements with classification and your reading of any ambiguous phrase.
Step 6: a list of files changed, one line each, and the new open question numbers.
