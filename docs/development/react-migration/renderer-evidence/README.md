# Routed renderer evidence

Original baseline `4dc2a06a4fc57ff393ea43ef4b75014b1458eb9b`; Chromium151.0.7922.34; actual `/qa`, intercepted local workflow responses. These are behavior-probe screenshots with real clock/UUIDs, not the frozen screenshot references owned by `migration-parity`. Images were staged outside the frontend watched tree and copied after browsers closed.

| Artifact | Checked behavior |
| --- | --- |
| [answer-fixture.json](answer-fixture.json) | Full answer-schema-shaped payload including inline Vega/Vega-Lite, inert SVG/HTML code, writing colon fence, WARNING alert and multiline collapsible details. Substitute current request ID in both envelope and result. |
| [vega-and-vega-lite.png](vega-and-vega-lite.png) | Two local SVG charts from inline values, native diagram controls, no remote resources. |
| [colon-alert-details.png](colon-alert-details.png) | Labeled writing panel/Copy, amber WARNING, expanded custom details body. |
| [svg-only-answer.json](svg-only-answer.json), [svg-preview.png](svg-preview.png) | Standalone inert SVG fence Preview opens artifact pane containing the green circle SVG; no iframe. |
| [html-only-answer.json](html-only-answer.json), [html-preview.png](html-preview.png) | Standalone inert HTML fence Preview opens artifact pane containing visible bold HTML. |
| [observations.json](observations.json) | Exact browser, chart count2, preview DOM/sandbox metadata, blocked request list and preview lifecycle errors. |

## Sanitization actually established

Observed: `javascript:` Markdown href was removed in the earlier rich probe; literal `<script>` claim text did not execute; external Markdown image showed Image unavailable; external iframe was blocked. SVG-only preview visibly rendered local SVG; Vega/Lite inline data produced two SVG charts without outbound requests. These observations do not constitute a general security certification.

Source: `src/lib/utils/index.ts:2227` sanitizes SVG with DOMPurify's SVG profiles and hooks dropping external resource/style/use references. `src/lib/utils/index.ts:2315` compiles Vega/Vega-Lite and rejects loader-based external resources before rendering SVG. `MarkdownInlineTokens.svelte:78` applies `safeLinkUrl` to Markdown anchors; `HTMLToken.svelte:17` sanitizes the generic HTML token path.

HTML artifact preview follows a different path: `Artifacts.svelte:246` uses `srcdoc` with `injectCsp`; the observed sandbox was `allow-scripts allow-downloads allow-forms` (no same-origin). `utils/csp.ts:8` returns the HTML unchanged when no iframe-specific CSP is configured. Only inert HTML was supplied; no unsafe execution probe was run. Safe inert HTML presentation must not be confused with authorization to preserve model-supplied scripting. Preview lifecycle logged sandbox-origin access errors, although the inert content visibly rendered.

## Source entry points

All paths below are relative to `app/document-qa/frontend/` at the baseline:

- `src/lib/components/chat/Messages/CodeBlock.svelte:379`: Vega/Vega-Lite render branch; `:537`: HTML/SVG Preview affordance.
- `src/lib/components/common/SVGPanZoom.svelte:33`: sanitized SVG view and local download/reset/copy controls.
- `src/lib/components/chat/Artifacts.svelte:246`: HTML iframe preview; `:269`: SVG preview.
- `src/lib/components/chat/Messages/Markdown/MarkdownTokens.svelte:303`: GFM alerts; `:502`: multiline details; `:632`: colon-fence component.
- `src/lib/utils/marked/extension.ts:29`: details token requires newline after opening tag/summary; one-line raw details is a different path.
- `src/lib/utils/marked/colon-fence-extension.ts:27`: generic colon-fence tokenizer; `src/lib/components/chat/Messages/Markdown/ColonFenceBlock.svelte:45`: subject/header, Copy and nested Markdown.

Renderer contract: preserve local charts, sanitized SVG, inert HTML preview, structured colon panels, warning labels and expandable details. The existing Python Run exception and no-execution/offline boundary remain in force.

## Safe action closure

[safe-actions.json](safe-actions.json) contains asserted clipboard/download/scroll/transform outcomes; [safe-actions.png](safe-actions.png) shows the returned long response after More Concise. [table.csv](table.csv) and [diagram.svg](diagram.svg) are the actual user-selected local export outputs. Table Copy returns original Markdown; CSV exports correct quoted data with BOM. Diagram Copy returns the original spec, Download produces SVG, control-wheel zoom changes transform and Reset returns identity after scheduled paint. User Copy equals question; single-model info click is a no-op; scroll-to-bottom reaches its maximum; More Concise repeats latest question without a revision payload.
