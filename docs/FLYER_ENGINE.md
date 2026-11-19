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

- Upload a template background (PNG/JPG). Or import a PSD; see "Built (2026-11-12)" below.
- Add, move, resize and rotate photo and text slots on a canvas.
- Bind each slot to a data field.
- Upload custom fonts (TTF/OTF; WOFF later) at platform or organization level.
- Photo fitting: cover or contain, with a simple crop and position adjustment per nominee. *Built 2026-11-12: cover or contain per template, position and zoom per nominee (see "Photo position, zoom and fit" below).*
- Text overflow handling: shrink to fit long names, with a minimum size and an ellipsis fallback.
- Preview with a sample nominee.
- Server-side rendering to PNG/JPG at high resolution.
- Bulk generation and download (individually or as a ZIP).
- Template versioning, so regenerating after an edit is predictable.

## Later / stretch

- Leaderboard flyers generated from live results (agreed 2026-11-13 as a later feature, #22).
- Background removal for nominee photos.
- QR code slot linking to the nominee's voting page.

## Decided (2026-11-13)

- **Who builds templates (#17):** each organization builds and owns its templates. The platform also offers a library of ready-made templates that any organization can copy and adapt, maintained by the super admin. *The library is not built yet.*
- **Editing freedom (#18):** the editor stays a slot placer, as built. No drawing tools, shapes or image editing.
- **Price (#20):** flyer generation is free for every organization.
- **Sizes (#21):** one flyer per nominee, at the template's own size.

## Built (2026-10-14)

- **Slot model** (`src/lib/flyer/model.ts`): one optional photo frame (rectangle with corner radius, or ellipse) and up to twenty text slots bound to nominee name, voting code, category, event title, the USSD instruction, the privacy notice (added 2026-11-19), or custom text; each with position, size, rotation, font, weight, size, minimum size, colour, alignment, uppercase and a line limit. Stored in `FlyerTemplate.canvasJson`; slots are not a separate table.
- **Editor** (`/dashboard/{org}/events/{event}/flyer/{template}`): Fabric.js draws the background and the slots and handles drag, resize and rotate; a properties panel sets the rest; fonts upload as TTF/OTF and load in the page through the FontFace API; preview renders a sample nominee server-side. Owner, admin and designer roles.
- **Renderer** (`src/lib/flyer/render.ts`): `@napi-rs/canvas` on the server, not Fabric. Prebuilt binaries, no native build, custom fonts registered from files. The default slot font, Poppins (the app font), ships with the renderer in seven weights under the SIL Open Font License (`src/lib/flyer/fonts/poppins/`), so a template with no uploaded fonts still renders as it looks in the editor. The browser preview and the server share the same slot geometry and the same text-fitting code (`layout.ts`), which is the "same JSON, same output" goal of the technical notes below achieved without running Fabric on the server.
- **Generation** (`generate-server.ts`): `ensureFlyer(nomineeId)` renders when the template version, photo, name, code, category, event title, USSD shortcode (`USSD_SHORTCODE`, so setting it re-renders every flyer the next time each is ensured or the organizer presses "Generate") or renderer version (`RENDERER_VERSION` in `render.ts`, bumped whenever a renderer or built-in font change would alter existing flyers) changed, and otherwise does nothing; it runs after a photo upload (the nominee's in the portal, or the organizer's from the event page), a profile or organizer edit and a template publish via Next's `after()`, and in batches of ten from the organizer's "Generate" button. Output goes to the `flyers` bucket, public read, and the nominee downloads it from the portal.
- **Template assignment**: a published template with the nominee's `categoryId`, else the event-wide one. Nothing published means "flyer coming soon".
- **As decided**: templates are organization-owned (#17; the platform library is not built); output is the template's native size (#21); edits regenerate automatically (decided 2026-11-13, #33); the USSD instruction reads `USSD_SHORTCODE`.

## Built (2026-11-12): PSD import and the font library

- **PSD import** (decided 2026-11-12, #19): "Import a Photoshop file" in the editor reads the PSD in the browser with `ag-psd` (the file is never uploaded). `src/lib/flyer/psd-plan.ts` finds placeholder layers, named or containing `{{name}}`, `{{code}}`, `{{category}}`, `{{event}}`, `{{ussd}}`, `{{photo}}` or `{{photo:round}}`, and turns them into slots: text slots take the layer's font, size (through its transform), colour, alignment and all-caps; paragraph text keeps its box; point text is widened to fit longer names on one line: inside the smallest background shape that contains it (keeping the designer's margin), or else to 60% of the width around its anchor. Every other layer is background (`src/components/flyer/psd-import.ts`): with the placeholder layers hidden it is Photoshop's flattened image, exact; with them visible it is redrawn from the layers (opacity, common blend modes, groups, layer and clipping masks, and solid-colour shape layers such as rounded boxes; not layer effects or gradient shape fills), and the importer warns. The background is uploaded like any other and the slots are scaled to it. Import replaces the template's slots. Layers above the photo become the template's **foreground** (`foregroundFileId`), a transparent PNG kept only over the photo's area (elsewhere the background already shows them) and drawn right after the photo slot, so text slots after it stay on top; layers with a blend mode (a multiply shadow) are left out of it and the importer says so. The photo takes the placeholder's own **shape** (`photoMaskFileId`, photo slot shape `mask`): its pixels and layer mask, or the shape it is clipped to, so a photo can fill a phone screen or a torn-paper frame. A new plain background clears both; the editor shows the overlay see-through and can remove it.
- **Font detection and the library** (decided 2026-11-12): the importer sends the slot fonts' PostScript names to `POST /api/orgs/{org}/fonts/resolve` (`font-resolve-server.ts`). Each is reported as ready (the organization's, a platform font, or the built-in Poppins), added from Google Fonts (`google-fonts.ts`: the family list from `fonts.google.com/metadata/fonts` cached a day, one static TTF per weight and style from the CSS API, stored once as a platform font every organization can use; the closest weight if the exact one does not exist), or upload needed (not on Google Fonts: someone with a licence uploads it under the family shown, and it stays private to the organization). Fonts used only by static text are listed for information; they are already in the background. Text slots can be italic.

## Built (2026-11-12): photo position, zoom and fit

- **Fit (per template).** The photo slot has a fit, set in the editor's properties panel: `cover` (the default, and what templates saved before it existed mean) fills the frame and crops the photo; `contain` shows the whole photo, centred, with the template's background showing in the rest of the frame.
- **Position and zoom (per nominee).** The nominee (in the portal) or an organizer manager (in the nominee's edit panel) taps the part of the photo that must stay in view, usually the face, and can zoom from 100% to 300%. They are stored on the nominee as `photoFocusX` and `photoFocusY` (percent from the photo's top-left corner) and `photoZoom` (percent) (`src/lib/photo-focus.ts`).
- **Geometry.** `placePhoto` in `layout.ts` scales the photo to cover or fit the frame, then by the zoom; along each axis a photo larger than the frame is cropped around the point, as CSS `object-position` does, and a smaller one is centred. A photo with the same shape as the frame has nothing to crop at 100%, so there the point only matters once it is zoomed.
- **Picker** (`src/components/flyer/PhotoFocusPicker.tsx`): shows the whole photo with the point, a zoom slider, and an outline of the area the flyer will show, computed with the same `placePhoto` from the frame of the published template that applies to the nominee. Without a published template there is no outline.
- **Regeneration.** Centre at 100% is the default and is stored as nulls, so flyers of photos nobody adjusted keep their source hash; a changed position or zoom re-renders the flyer, and uploading a new photo resets both. A fit change reaches flyers when the template is published again, like any template edit.

## Built (2026-11-19): privacy notice

- **Every flyer names the privacy policy** (decision #28: USSD voters are covered by the policy named on the website and on flyers). The text is `Privacy policy: <app host>/privacy`, from `NEXT_PUBLIC_APP_URL` (`privacyNotice` in `bindings.ts`); it is part of each flyer's source hash, so setting or changing the URL re-renders flyers the next time they are ensured.
- **Designer's slot:** a `privacy.notice` text binding ("Privacy notice" in the editor), and `{{privacy}}` as a PSD placeholder, so the notice can be placed and styled like any other text.
- **Fallback:** a template with no privacy slot gets a small line along the bottom, drawn by the renderer: white Poppins on a translucent dark band, about 1.6% of the flyer's height (at least 12px), shrunk to fit the width. The server preview shows it; the editor canvas does not. `RENDERER_VERSION` went to 3 with it, so existing flyers re-render.

## Technical notes

- What the designer sees must be what gets rendered. As built, this is done with shared slot geometry and text-fitting code (`layout.ts`) rather than running Fabric on the server; see "Built" above.
- Fonts must be loaded on the server renderer before rendering, or text will fall back to a default font.
- Rendering never blocks the request. As built it runs after the response via Next's `after()`, and in batches of ten from the organizer's "Generate" button; an Appwrite Function is the scale-up path for very large batches (see `functions/README.md`).
- Templates, fonts, nominee photos and generated flyers live in Appwrite Storage buckets.
- Fabric.js is an addition on top of the pickLT stack (see `ARCHITECTURE.md`, "Added for this product"). The editor UI itself uses pickLT's shared components and theme.
- Store generated flyers with the template version used to make them.
