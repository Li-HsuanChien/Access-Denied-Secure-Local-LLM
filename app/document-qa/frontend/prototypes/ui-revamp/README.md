# UI revamp prototype ("Reading room")

An interactive, review-only prototype of a redesigned Access Denied interface.
It is **separate from the production frontend**: it has its own Vite entry,
styles and state, and changes no production route, provider, style, backend
contract or behavior. Everything runs on loopback with locally bundled assets.

All documents, answers and conversations are **fictional sample data**
("Lakeside Research Reactor"). Nothing here is a real record.

## Open it

From `app/document-qa/frontend` (dependencies are the frontend's existing ones; nothing new is installed):

```bash
npm run prototype
```

Then open <http://127.0.0.1:5180>. The server binds to 127.0.0.1 only.

To check or build it:

```bash
npm run prototype:check   # TypeScript
npm run prototype:build   # static build in prototypes/ui-revamp/dist (git-ignored)
```

A **Prototype** button (dashed, saffron, top right) opens review controls:
switch the local model between ready / starting / down, make the next answer,
history save, setting change or PDF publication fail, turn on fast mode, empty
the library, prefill demo questions, or reset everything.

## Suggested walkthrough

1. **Document answer.** On the home screen choose *Pump inspections*. Watch the
   status line (searching → reading passages → writing), then click citation **1**.
   The pop-up shows the exact quote, document title and page; nothing else loads.
2. **Show document page.** The PDF opens beside the chat (full screen below
   1180 px), scrolled to the cited passage with a saffron highlight. Use page
   arrows, the page box, − / Fit / + (or `+`, `-`, `0`, `←`, `→`), then close or
   press Escape; focus returns to the citation.
3. **Partial evidence.** Ask *Why did worker dose readings go up in 2024?* The
   answer explains what the documents do and don't say, with one warning.
4. **General knowledge.** Ask *What is the half-life of cobalt-60?* It's labeled
   “General knowledge · no supporting documents”, set apart with an indigo rule, and has no citations.
   Turn **General knowledge** off in the composer and ask again for the
   “No supporting documents” answer and its one-click way back.
5. **Library.** Add your own PDFs (checked in the browser, never uploaded) or use
   *Review a sample set*: two files pass; a scanned-only file, a password-protected
   file and a .docx are rejected with reasons. Confirm, add, and navigate away while
   it runs; the sidebar shows progress. Toggle documents on/off, preview, delete.
6. **Switched-off documents.** Switch off a document, then ask about it; the
   answer falls back. The saved *Evacuation drill frequency* chat still shows quotes from
   the switched-off 2019 plan.
7. **History.** *Search chats* (`⌘K` / `Ctrl+K`) searches titles, questions and
   answers; select a chat to preview it, then continue or delete it.
8. **Settings** (`⌘,` / `Ctrl+,`). Plain-language switches with Saving… / Saved /
   error states, inline “delete all” confirmation (no stacked dialog), theme.
9. **Temporary chat.** The dashed bubble icon at top right starts a chat that is never saved.
10. Resize to tablet and phone widths: the sidebar becomes a drawer, the PDF
    viewer goes full screen with a Back button, and dialogs fit the screen.

## Design direction

**Calm and literate, like a quiet reading room.** The current UI is gray and technical; this
direction uses warm paper surfaces, ink-brown text and three colors that each mean one thing:

| Color | Meaning |
| --- | --- |
| Evergreen | Document-backed answers, primary actions, citations |
| Indigo | General knowledge (never mixed with citations) |
| Saffron | The original source: quote rule and PDF highlight |

Color never carries meaning alone; every state also has an icon and words.

- **Type does the work.** Interface text is the bundled Inter. Headings and,
  importantly, **original source quotations use the system serif** (New York,
  Iowan, Charter, Georgia). Quotes look like a printed page, while the assistant's
  explanation stays sans-serif, so the two are hard to confuse.
- **Familiar shape.** A ChatGPT/Claude-style layout: conversation sidebar grouped by date, centered reading
  column (~46rem), a rounded composer with two quiet chips (documents in use,
  general knowledge on/off), and actions that appear on hover (always on touch).
- **One answer, one label.** Each response starts with a small basis line
  (“Based on your documents” / “General knowledge · no supporting documents” /
  “No supporting documents”). Limits are written into the answer; a consequential
  warning appears once, as a single amber note.
- **Right-sized surfaces.** Small things use popovers (citation quote, status,
  answer details, documents in use); reading a PDF gets a side panel or full
  screen; settings use one compact dialog; destructive actions use a small
  confirmation. Dialogs never stack: “delete all history” is confirmed inline.
- **Library staging is visibly different.** Files under review sit in a dashed, sunken
  tray labeled “Waiting for your review · not used in answers yet”. Documents already
  in use are plain rows with an “Used in answers” switch.
- **Personality through copy and motion.** Plain, warm sentences (“What would you like to find out?”,
  “I couldn't find a stated reason…”), a shimmering status phrase while answering,
  and short fade/slide transitions. All motion is removed under `prefers-reduced-motion`.
- **Accessibility.** Visible focus everywhere, Escape closes every overlay, focus
  returns to the trigger (or a sensible neighbor after a delete), modal dialogs
  trap focus and make the app `inert`, live regions announce answers and progress,
  `⌘B` toggles the sidebar, and text color pairs meet WCAG AA (≥ 4.5:1) in both themes.

## What is real vs. simulated

| Area | In this prototype | In the production app today |
| --- | --- | --- |
| Answers | **Simulated.** Keyword-matched, scripted replies with fake delays. Each reply is a real `Answer` object (production wire type). | `answering.ask` via the local host and llama.cpp |
| Citation pop-up (quote, title, pages) | Real behavior on sample data | Supported (quote-first pop-up) |
| PDF viewer | **Real pdf.js rendering** with production's hardened options; highlights from stored `highlight_rects` | Supported via `GET /v1/source`; same pdf.js approach |
| Answer-in-progress status (searching / reading / writing) | **Simulated.** Phases are invented for feedback | Host returns one result; no progress events today |
| Library review | Checks run **in the browser** with pdf.js (not a PDF, password, scanned-only, size) | `library.review` on the Python host |
| Publishing progress, cancel | **Simulated** phases and cancel | Publication completes in one request; progress and cancel are planned (SDD §4.1) |
| Document on/off, delete | Simulated saves | Supported |
| History list, open, delete, clear, search | In memory; search is client-side | list/open/delete/clear supported; **full-text search is new** (client-side filtering of `history.list` titles is feasible today) |
| Settings: general knowledge, history on/off | Simulated saves with Saved/error states | Supported (`settings.update`, `history.set_enabled`) |
| Theme (System / Light / Dark) | Front-end only | Not exposed in settings today |
| Model status (ready / starting / down) | Simulated from the Prototype panel | Derived from `/health` |
| Temporary chat | In memory | Supported (`?local-temporary=true`) |
| "Answer details" (model, time, passages, library version) | From the sample `Answer` payload | Same fields exist in the answer payload |

Nothing in the prototype calls the host; it never touches user data.

## Security and privacy notes

- Imported PDFs and quotes are untrusted: quotes, file names and titles render as
  plain React text; PDFs render only in a pdf.js canvas (`isEvalSupported: false`,
  no system or remote fonts, no XFA), never in an iframe.
- Files chosen in the Library stay in memory in this tab; nothing is uploaded or stored.
- No fonts, scripts or styles load from the network. `index.html` sets a
  Content-Security-Policy that allows only same-origin resources (plus the dev server's loopback socket).

## Adopting it

The prototype is organized like the production features (`features/chat`,
`library`, `history`, `settings`, `pdf`, `shell`) so pieces can be moved over one at a time. Before adopting:

- Update the PRD/SDD (and add an ADR superseding the Open WebUI presentation-parity goal in ADR 0004), per `AGENTS.md`.
  They are intentionally unchanged here because this direction isn't approved yet.
- The production shell preserves Open WebUI presentation and branding under its
  license (`LICENSE`, `static/BRANDING.md`). Confirm with the license owner how a new
  visual identity may coexist with those branding terms.
- Consider bundling an OFL serif (e.g. Source Serif) instead of the system serif so quotes look the same on every platform.
- Decide whether the invented answer phases should become real progress events
  or be reduced to a single “Working on it” state.

## Credits

Interaction behavior (popover, dialog, alert dialog, menu, switch, tooltip,
radio group) follows the WAI-ARIA patterns as documented by
[Radix Primitives](https://www.radix-ui.com/primitives); component anatomy
(dialog header/footer, sheet-like side panel, sidebar groups) is inspired by
[shadcn/ui](https://ui.shadcn.com/). The quiet toast and inline AI-status ideas
were prompted by the [RareUI](https://www.rareui.com/) catalog. [OpenUI](https://www.openui.com/) was reviewed;
its hosted services don't fit an offline product, so nothing from it is used. **No code was copied** from these
projects; all components and icons here are original.

The pdf.js text-layer rules in `src/styles/pdf.css` are adapted from
`pdfjs-dist/web/pdf_viewer.css` (Apache-2.0). Sample PDFs embed Liberation Sans
from `pdfjs-dist/standard_fonts` (SIL Open Font License 1.1). Inter is the
frontend's bundled copy (SIL OFL 1.1). Regenerate the samples with
`.venv/bin/python app/document-qa/frontend/prototypes/ui-revamp/scripts/make_samples.py`.
