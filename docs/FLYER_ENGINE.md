# Flyer Engine

The main differentiator. Today every organizer pays a designer to make a flyer for each nominee after nominees are confirmed. We remove that step.

## Concept: design once, personalize for every nominee

1. **Design (outside the platform).** A graphic designer creates the flyer artwork in Photoshop, Photopea or similar. The artwork includes the background, graphics, an empty photo area and styled placeholder text.
2. **Template setup (inside the platform).** The template is uploaded to a lightweight browser editor (Fabric.js). Someone marks the **slots**:
   - a photo frame (position, size, shape or mask)
   - text slots bound to data: nominee name, category, nominee code, USSD instruction (e.g. "Dial *xxx*xx# → 42"), event name and date
   - fonts, sizes, colours and alignment for each text slot
3. **Generation (automatic).** When a nominee's photo is uploaded, whether by the organizer or by the nominee in the nominee portal, the platform fills the slots and renders a finished flyer. The nominee sees and downloads it in their portal as soon as it is ready. Bulk generation covers whole categories or events.

Trigger rule: a template must be assigned to the event (or category) before nominees complete their profiles, otherwise there is nothing to render. If no template is assigned, the portal shows "flyer coming soon" and the render job runs once a template is assigned.

## Reference point: Photopea

Photopea shows that a full PSD editor can run in the browser. **We are not building that.** A Photopea-level editor would take years and would swallow the voting product. Heavy creative work stays in the designer's own tools; our editor only personalizes templates.

## MVP scope

- Upload a template background (PNG/JPG). Optionally upload a layered file; see "PSD import" below.
- Add, move, resize and rotate photo and text slots on a canvas.
- Bind each slot to a data field.
- Upload custom fonts (TTF/OTF; WOFF later) at platform or organization level.
- Photo fitting: cover or contain, with a simple crop and position adjustment per nominee.
- Text overflow handling: shrink to fit long names, with a minimum size and an ellipsis fallback.
- Preview with a sample nominee.
- Server-side rendering to PNG/JPG at high resolution.
- Bulk generation and download (individually or as a ZIP).
- Template versioning, so regenerating after an edit is predictable.

## Later / stretch

- **PSD import:** read a PSD (e.g. with `ag-psd`), turn its layers into Fabric objects, and let layers with agreed names (e.g. `{{photo}}`, `{{name}}`) become slots automatically. Partial support is acceptable.
- Size variants from one design: WhatsApp Status (1080×1920), square post (1080×1080) and print.
- Leaderboard flyers generated from live results (proposed, not agreed).
- Background removal for nominee photos.
- QR code slot linking to the nominee's voting page.

## Open questions (also in OPEN_QUESTIONS.md)

- Who builds templates: our in-house designers, the organizer's designer, or both? Is there a platform template library?
- How much freedom do organizers get in the editor: slot positions only, or general editing too?
- Is flyer generation free in all plans or a paid feature?
- How far should PSD import go?

## Built (2026-10-14)

- **Slot model** (`src/lib/flyer/model.ts`): one optional photo frame (rectangle with corner radius, or ellipse) and up to twenty text slots bound to nominee name, voting code, category, event title, the USSD instruction, or custom text; each with position, size, rotation, font, weight, size, minimum size, colour, alignment, uppercase and a line limit. Stored in `FlyerTemplate.canvasJson`; slots are not a separate table.
- **Editor** (`/dashboard/{org}/events/{event}/flyer/{template}`): Fabric.js draws the background and the slots and handles drag, resize and rotate; a properties panel sets the rest; fonts upload as TTF/OTF and load in the page through the FontFace API; preview renders a sample nominee server-side. Owner, admin and designer roles.
- **Renderer** (`src/lib/flyer/render.ts`): `@napi-rs/canvas` on the server, not Fabric. Prebuilt binaries, no native build, custom fonts registered from files. The default slot font, Poppins (the app font), ships with the renderer in seven weights under the SIL Open Font License (`src/lib/flyer/fonts/poppins/`), so a template with no uploaded fonts still renders as it looks in the editor. The browser preview and the server share the same slot geometry and the same text-fitting code (`layout.ts`), which is the "same JSON, same output" goal of the technical notes below achieved without running Fabric on the server.
- **Generation** (`generate-server.ts`): `ensureFlyer(nomineeId)` renders when the template version, photo, name, code, category, event title or renderer version (`RENDERER_VERSION` in `render.ts`, bumped whenever a renderer or built-in font change would alter existing flyers) changed, and otherwise does nothing; it runs after a photo upload (the nominee's in the portal, or the organizer's from the event page), a profile or organizer edit and a template publish via Next's `after()`, and in batches of ten from the organizer's "Generate" button. Output goes to the `flyers` bucket, public read, and the nominee downloads it from the portal.
- **Template assignment**: a published template with the nominee's `categoryId`, else the event-wide one. Nothing published means "flyer coming soon".
- **Placeholders**: templates are organization-owned (#17); output is the template's native size (#21); edits regenerate automatically (#33); the USSD instruction reads `USSD_SHORTCODE`.

## Technical notes

- What the designer sees must be what gets rendered. As built, this is done with shared slot geometry and text-fitting code (`layout.ts`) rather than running Fabric on the server; see "Built" above.
- Fonts must be loaded on the server renderer before rendering, or text will fall back to a default font.
- Rendering never blocks the request. As built it runs after the response via Next's `after()`, and in batches of ten from the organizer's "Generate" button; an Appwrite Function is the scale-up path for very large batches (see `functions/README.md`).
- Templates, fonts, nominee photos and generated flyers live in Appwrite Storage buckets.
- Fabric.js is an addition on top of the pickLT stack (see `ARCHITECTURE.md`, "Added for this product"). The editor UI itself uses pickLT's shared components and theme.
- Store generated flyers with the template version used to make them.
