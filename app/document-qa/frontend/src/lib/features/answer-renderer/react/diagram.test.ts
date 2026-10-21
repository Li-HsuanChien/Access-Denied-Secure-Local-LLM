import { afterEach, expect, it, vi } from "vitest";
import mermaid from "mermaid";
import { inlineSvgStyles, renderDiagram } from "./Diagrams";
import { sanitizeSvg } from "./security";
afterEach(() => {
  vi.restoreAllMocks();
});

const imageMetadata = [
  'img: "http://127.0.0.1:4177/renderer-canary.svg"',
  '"img": "/renderer-canary.svg"',
  "'img': '../renderer-canary.svg'",
  String.raw`"i\u006dg": "\u0068ttp://127.0.0.1:4177/renderer-canary.svg"`,
  String.raw`"\x69mg": "/renderer-canary.svg"`,
  String.raw`"\U00000069mg": "file:///renderer-canary.svg"`,
  'img: "//example.test/renderer-canary.svg"',
  'img: "#paint"',
  'img: "data:image/svg+xml;base64,PHN2Zy8+"',
  'img: "blob:http://127.0.0.1:4177/canary"',
  '\n  "img": >-\n    http://127.0.0.1:4177/renderer-canary.svg\n  label: Canary\n',
];
it.each(imageMetadata)(
  "rejects parsed Mermaid image metadata before render: %s",
  async (metadata) => {
    const source = `flowchart LR\n A@{${metadata}}`;
    // The real bundled YAML/flowchart parser must recognize each adversarial form.
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      htmlLabels: false,
    });
    const parsed = await mermaid.mermaidAPI.getDiagramFromText(source);
    const db = parsed.db as {
      getVertices: () => Map<string, { img?: string }>;
    };
    expect(db.getVertices().get("A")?.img).toBeTruthy();
    const draw = vi
      .spyOn(mermaid, "render")
      .mockResolvedValue({
        svg: '<svg xmlns="http://www.w3.org/2000/svg"/>',
        diagramType: "flowchart-v2",
      });
    await expect(renderDiagram(source, "mermaid")).rejects.toThrow(/resource/i);
    expect(draw).not.toHaveBeenCalled();
  },
);
it("retains safe Mermaid metadata and normal diagram rendering", async () => {
  const draw = vi
    .spyOn(mermaid, "render")
    .mockResolvedValue({
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>Safe</text></svg>',
      diagramType: "flowchart-v2",
    });
  await expect(
    renderDiagram(
      'flowchart LR\n A@{ img: "/renderer-canary.svg" }',
      "mermaid",
    ),
  ).rejects.toThrow(/resource/i);
  expect(draw).not.toHaveBeenCalled();
  expect(
    await renderDiagram(
      'flowchart LR\n A@{ shape: rect, label: "Safe" } --> B[Done]',
      "mermaid",
    ),
  ).toContain("Safe");
  expect(draw).toHaveBeenCalledOnce();
});
it("keeps generated SVG root typography while applying sanitized descendant rules", () => {
  const value = sanitizeSvg(
    inlineSvgStyles(
      '<svg xmlns="http://www.w3.org/2000/svg" id="diagram"><style>#diagram{font-size:16px;font-family:Arial} #diagram text{fill:rgb(51,51,51)} #diagram{filter:url(http://127.0.0.1:8765/forbidden)}</style><text>A</text></svg>',
    ),
  );
  const template = document.createElement("template");
  template.innerHTML = value;
  const svg = template.content.querySelector("svg")!;
  expect(svg.style.fontSize, value).toBe("16px");
  expect(svg.style.fontFamily).toBe("Arial");
  expect(svg.querySelector("text")?.style.fill).toBe("rgb(51,51,51)");
  expect(value).not.toMatch(/<style|forbidden|127\.0\.0\.1/);
});
