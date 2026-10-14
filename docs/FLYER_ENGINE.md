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
- Upload custom fonts (TTF/OTF/WOFF) at platform or organization level.
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

## Technical notes

- Use the same Fabric JSON for the browser editor and the server renderer, so what the designer sees is what gets rendered.
- Fonts must be loaded on the server renderer before rendering, or text will fall back to a default font.
- Rendering runs in a background Appwrite Function (or a server-only route invoked asynchronously). Never block the request.
- Templates, fonts, nominee photos and generated flyers live in Appwrite Storage buckets.
- Fabric.js is an addition on top of the pickLT stack (see `ARCHITECTURE.md`, "Added for this product"). The editor UI itself uses pickLT's shared components and theme.
- Store generated flyers with the template version used to make them.
