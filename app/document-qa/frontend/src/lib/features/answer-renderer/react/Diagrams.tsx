import { translate, useI18n } from "@/react/i18n";
import { useEffect, useRef, useState } from "react";
import panzoom, { type PanZoom } from "panzoom";
import { assertInlineChart, assertSafeMermaid, sanitizeSvg } from "./security";
import { copyText, downloadText } from "./exports";
import { Icon } from "./Icon";

let diagramId = 0;
let mermaidSequence: Promise<unknown> = Promise.resolve();
/** Mermaid shares parser state, so renders serialize without sharing caller configuration. */
export async function renderDiagram(
  source: string,
  language: string,
): Promise<string> {
  if (language === "mermaid") {
    assertSafeMermaid(source);
    const operation = mermaidSequence
      .catch(() => {})
      .then(async () => {
        const { default: mermaid } = await import("mermaid");
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: document.documentElement.classList.contains("dark")
            ? "dark"
            : "default",
          htmlLabels: false,
          secure: [
            "securityLevel",
            "htmlLabels",
            "startOnLoad",
            "maxTextSize",
            "maxEdges",
          ],
          flowchart: { htmlLabels: false },
          suppressErrorRendering: true,
        });
        // Mermaid's YAML parser decodes quoted/escaped metadata keys and values.
        // Check its semantic nodes before render: image shapes create Image.src
        // requests during layout, before generated SVG can be sanitized.
        const parsed = await mermaid.mermaidAPI.getDiagramFromText(source);
        const db = parsed.db as {
          getVertices?: () => Map<string, { img?: unknown }>;
        };
        for (const vertex of db.getVertices?.().values() ?? []) {
          if (vertex.img)
            throw new Error("External diagram resources are disabled");
        }
        const { svg } = await mermaid.render(
          `react-diagram-${++diagramId}`,
          source,
        );
        return sanitizeSvg(inlineSvgStyles(svg));
      });
    mermaidSequence = operation;
    return operation;
  }
  const spec = JSON.parse(source) as Record<string, unknown>;
  assertInlineChart(spec);
  const vega = await import("vega");
  const { expressionInterpreter } = await import("vega-interpreter");
  let compiled = spec;
  if (language === "vega-lite") {
    const lite = await import("vega-lite");
    compiled = lite.compile(spec as never).spec as unknown as Record<
      string,
      unknown
    >;
    assertInlineChart(compiled);
  }
  // Never register expressions or supply a browser/network-capable loader.
  const deny = async (): Promise<never> => {
    throw new Error("External visualization resources are disabled");
  };
  const view = new vega.View(
    vega.parse(compiled as never, null as unknown as undefined, { ast: true }),
    {
      renderer: "none",
      expr: expressionInterpreter,
      loader: { load: deny, sanitize: deny, http: deny, file: deny },
    },
  );
  try {
    await view.runAsync();
    return sanitizeSvg(await view.toSVG());
  } finally {
    view.finalize();
  }
}

/** Preserve generated Mermaid style rules as sanitized inline declarations, scoped to this SVG. */
export function inlineSvgStyles(source: string): string {
  const doc = new DOMParser().parseFromString(source, "image/svg+xml");
  const svg = doc.documentElement;
  for (const style of [...svg.querySelectorAll("style")]) {
    const css = style.textContent ?? "";
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (/[\\@]/.test(rule[1])) continue;
      try {
        const targets = [...svg.querySelectorAll(rule[1])];
        if (svg.matches(rule[1])) targets.unshift(svg);
        for (const node of targets) {
          const existing = node
            .getAttribute("style")
            ?.trim()
            .replace(/;+\s*$/, "");
          node.setAttribute(
            "style",
            (existing ? existing + ";" : "") + rule[2],
          );
        }
      } catch {
        /* Unsupported selectors cannot affect surrounding app. */
      }
    }
    style.remove();
  }
  return new XMLSerializer().serializeToString(svg);
}

export function SvgPanZoom({
  svg,
  content,
  className = "",
}: {
  svg: string;
  content: string;
  className?: string;
}) {
  const { t } = useI18n();
  const target = useRef<HTMLDivElement>(null),
    instance = useRef<PanZoom | null>(null);
  const [copied, setCopied] = useState(false);
  const safe = sanitizeSvg(svg);
  useEffect(() => {
    const node = target.current;
    if (!node) return;
    const zoom = panzoom(node, {
      bounds: true,
      boundsPadding: 0.1,
      pinchSpeed: 3.5,
      beforeWheel: () => true,
    });
    instance.current = zoom;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const rect = node.getBoundingClientRect();
        zoom.zoomTo(
          event.clientX - rect.left,
          event.clientY - rect.top,
          Math.exp(-event.deltaY * 0.002),
        );
      } else if (
        Math.abs(zoom.getTransform().scale - 1) >= 0.01 &&
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
      ) {
        event.preventDefault();
        zoom.moveBy(-event.deltaX, -event.deltaY, false);
      }
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => {
      node.removeEventListener("wheel", wheel);
      zoom.dispose();
      instance.current = null;
    };
  }, [safe]);
  const button =
    "p-1.5 rounded-lg border border-gray-100 dark:border-none dark:bg-gray-850 hover:bg-gray-50 dark:hover:bg-gray-800 transition";
  return (
    <div className={`relative renderer-diagram ${className}`}>
      <div
        ref={target}
        className="flex h-full max-h-full justify-center items-center renderer-panzoom"
        dangerouslySetInnerHTML={{ __html: safe }}
      />
      <div className="absolute top-2.5 right-2.5 flex gap-1">
        <button
          type="button"
          title={t("Download as SVG")}
          aria-label={t("Download as SVG")}
          className={button}
          onClick={() =>
            downloadText(sanitizeSvg(safe), "diagram.svg", "image/svg+xml")
          }
        >
          <Icon name="download" strokeWidth={1.5} />
        </button>
        <button
          type="button"
          title={t("Reset view")}
          aria-label={t("Reset view")}
          className={button}
          onClick={() => {
            instance.current?.moveTo(0, 0);
            instance.current?.zoomAbs(0, 0, 1);
          }}
        >
          <Icon name="reset" strokeWidth={2} />
        </button>
        <button
          type="button"
          title={copied ? t("Copied to clipboard") : t("Copy to clipboard")}
          aria-label={t("Copy to clipboard")}
          className={button}
          onClick={() => {
            void copyText(content).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1000);
            });
          }}
        >
          <Icon name={copied ? "check" : "copy"} strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
}

export function Diagram({
  source,
  language,
}: {
  source: string;
  language: string;
}) {
  const [svg, setSvg] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    let disposed = false;
    setSvg("");
    setError("");
    void renderDiagram(source, language)
      .then((value) => {
        if (!disposed) setSvg(value);
      })
      .catch((error) => {
        if (!disposed)
          setError(
            `${language === "mermaid" ? translate("Failed to render diagram") : translate("Failed to render visualization")}: ${error instanceof Error ? error.message : String(error)}`,
          );
      });
    return () => {
      disposed = true;
    };
  }, [source, language]);
  return (
    <div
      className="relative flex flex-col rounded-2xl border border-gray-100/30 dark:border-gray-850/30 my-0.5 overflow-clip"
      dir="ltr"
    >
      {svg ? (
        <SvgPanZoom
          svg={svg}
          content={source}
          className="rounded-2xl max-h-fit overflow-hidden"
        />
      ) : (
        <div className="p-3">
          {error && (
            <div
              role="alert"
              className="flex gap-2.5 border px-4 py-3 border-red-600/10 bg-red-600/10 rounded-2xl mb-2"
            >
              {error}
            </div>
          )}
          <pre>{source}</pre>
        </div>
      )}
    </div>
  );
}
