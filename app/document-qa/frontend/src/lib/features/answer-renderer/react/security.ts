import DOMPurify from "dompurify";
import type { AppPath } from "../../react-contracts/application";

const APP_PATHS = new Set<AppPath>([
  "/",
  "/qa",
  "/library",
  "/history",
  "/settings",
]);
const LOCAL_FRAGMENT = /^#[A-Za-z_][\w:.-]*$/;
const LOCAL_PAINT = /^url\(\s*['"]?#[A-Za-z_][\w:.-]*['"]?\s*\)$/i;
// Presentation attributes are CSS declarations, including escaped CSS function names.
const SVG_PRESENTATION = new Set([
  "fill",
  "stroke",
  "filter",
  "clip-path",
  "mask",
  "marker",
  "marker-start",
  "marker-mid",
  "marker-end",
  "cursor",
  "color-profile",
]);
const RESOURCE_ATTRIBUTES =
  /^(?:src|srcset|poster|background|action|formaction|ping|data|codebase|manifest|profile|longdesc|cite)$/i;
const FORBIDDEN_ELEMENTS = [
  "script",
  "style",
  "base",
  "meta",
  "link",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "portal",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "option",
  "audio",
  "video",
  "source",
  "track",
  "image",
  "foreignObject",
  "animate",
  "animateMotion",
  "animateTransform",
  "set",
  "mpath",
];

export function safeAppPath(value: string): AppPath | null {
  if (value.startsWith("/") && !APP_PATHS.has(value as AppPath)) return null;
  if (
    !value ||
    value.trim() !== value ||
    value.startsWith("//") ||
    /[\\\u0000-\u0020]/.test(value)
  )
    return null;
  try {
    const url = new URL(value, window.location.origin);
    return url.origin === window.location.origin &&
      !url.search &&
      !url.hash &&
      APP_PATHS.has(url.pathname as AppPath)
      ? (url.pathname as AppPath)
      : null;
  } catch {
    return null;
  }
}

/** CSS declarations are parsed first; resource-capable or escaped values never reach a live node. */
function safeStyle(value: string, svg: boolean): string {
  const style = document.createElement("span").style;
  style.cssText = value;
  for (const name of Array.from({ length: style.length }, (_, index) =>
    style.item(index),
  )) {
    const declaration = style.getPropertyValue(name);
    if (
      /[\\@<>]/.test(declaration) ||
      /(?:expression|image|image-set|paint|element|var|attr)\s*\(/i.test(
        declaration,
      ) ||
      (/url\s*\(/i.test(declaration) &&
        !(svg && LOCAL_PAINT.test(declaration.trim()))) ||
      name.startsWith("--") ||
      name === "behavior" ||
      name === "-moz-binding"
    )
      style.removeProperty(name);
  }
  return style.cssText;
}

function sanitizeMarkup(value: string, svg: boolean): string {
  const clean = DOMPurify.sanitize(value, {
    USE_PROFILES: svg
      ? { svg: true, svgFilters: true }
      : { html: true, svg: true, svgFilters: true },
    FORBID_TAGS: FORBIDDEN_ELEMENTS,
    FORBID_ATTR: ["autofocus", "srcdoc", "target", "download", "is"],
    ALLOW_DATA_ATTR: false,
  });
  const template = document.createElement("template");
  template.innerHTML = clean;
  for (const node of template.content.querySelectorAll("*")) {
    for (const attr of [...node.attributes]) {
      const name = attr.name.toLowerCase();
      const localSvg = node.namespaceURI === "http://www.w3.org/2000/svg";
      if (
        name.startsWith("on") ||
        RESOURCE_ATTRIBUTES.test(name) ||
        name === "srcdoc" ||
        name === "xml:base" ||
        ((name === "href" || name === "xlink:href") &&
          !(
            localSvg &&
            node.localName !== "a" &&
            LOCAL_FRAGMENT.test(attr.value)
          ))
      ) {
        node.removeAttribute(attr.name);
      } else if (localSvg && /[\\@<>]/.test(attr.value)) {
        // No SVG drawing attribute needs CSS escapes; reject before browser parsing.
        node.removeAttribute(attr.name);
      } else if (localSvg && SVG_PRESENTATION.has(name)) {
        const style = document.createElement("span").style;
        style.setProperty(name, attr.value);
        const safe = safeStyle(style.cssText, true);
        style.cssText = safe;
        const parsed = style.getPropertyValue(name);
        if (parsed) node.setAttribute(attr.name, parsed);
        else node.removeAttribute(attr.name);
      } else if (name === "style") {
        const safe = safeStyle(attr.value, localSvg);
        if (safe) node.setAttribute("style", safe);
        else node.removeAttribute(attr.name);
      } else if (
        /url\s*\(/i.test(attr.value) &&
        !(localSvg && LOCAL_PAINT.test(attr.value.trim()))
      )
        node.removeAttribute(attr.name);
    }
  }
  return template.innerHTML;
}

/** Applied both before mounting and before every SVG download. */
export function sanitizeSvg(value: string): string {
  return sanitizeMarkup(value, true);
}

export const PREVIEW_CSP =
  "default-src 'none'; script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; style-src 'unsafe-inline'; img-src data: blob:";
export function htmlPreviewDocument(value: string): string {
  const body = sanitizeMarkup(value, false);
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}"><meta charset="utf-8"></head><body>${body}</body></html>`;
}

/** URL-bearing fields are forbidden at every depth, including expression-driven encodings. */
export function assertInlineChart(value: unknown): void {
  const visit = (node: unknown, depth: number): void => {
    if (depth > 100) throw new Error("Visualization is too deeply nested");
    if (Array.isArray(node)) {
      node.forEach((item) => visit(item, depth + 1));
      return;
    }
    if (!node || typeof node !== "object") return;
    for (const [key, item] of Object.entries(node)) {
      if (
        /^(?:url|href|src|srcset|baseURL|backgroundImage)$/i.test(key) ||
        ((key === "type" || key === "mark") && item === "image")
      )
        throw new Error("External visualization resources are disabled");
      visit(item, depth + 1);
    }
  };
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid visualization specification");
  visit(value, 0);
}

export function assertSafeMermaid(value: string): void {
  if (
    /%%\s*\{|^\s*---|(?:^|[\n;])\s*click\s|\b(?:href|xlink:href)\s*=|url\s*\(|@import|!\[|(?:^|[\n;])\s*(?:style|classDef)\b[^\n]*\\|<\s*(?:script|iframe|img|image|foreignObject)\b/i.test(
      value,
    )
  )
    throw new Error("Interactive diagram configuration is disabled");
}
