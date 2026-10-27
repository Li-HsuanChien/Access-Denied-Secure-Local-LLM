import { describe, expect, it } from "vitest";
import {
  safeAppPath,
  sanitizeSvg,
  htmlPreviewDocument,
  assertInlineChart,
  assertSafeMermaid,
} from "./security";

describe("untrusted renderer boundaries", () => {
  it("only retains exact supported same-origin navigation", () => {
    expect(safeAppPath("/library")).toBe("/library");
    expect(safeAppPath(window.location.origin + "/history")).toBe("/history");
    for (const value of [
      "https://example.com",
      "//example.com",
      "javascript:alert(1)",
      "data:text/html,hi",
      "http://127.0.0.1:8765/health",
      "/api/v1/files/x",
      "/./library",
      "/library?q=x",
      "/library#x",
      "/c/x",
    ])
      expect(safeAppPath(value)).toBeNull();
  });
  it("sanitizes inline and exported SVG while preserving safe local drawing references", () => {
    const value = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="paint"><stop offset="0" stop-color="red"/></linearGradient></defs><rect fill="url(#paint)" width="40"/><script>alert(1)</script><foreignObject><iframe src="http://127.0.0.1:8765"></iframe></foreignObject><image href="https://evil.test/a"/><a href="https://evil.test"><text onclick="alert(1)">safe</text></a><use href="http://evil.test/a#b"/><set attributeName="href" to="https://evil.test"/><path style="fill:url(https://evil.test/a)"/></svg>',
    );
    expect(value).toContain("url(#paint)");
    expect(value).toContain("safe");
    expect(value).not.toMatch(
      /script|foreignObject|iframe|evil\.test|127\.0\.0\.1|onclick|attributeName/i,
    );
  });
  it("rejects escaped CSS resources in SVG presentation attributes and exports", () => {
    const source = String.raw`<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="paint"/></defs><rect fill="u\72l(http://127.0.0.1:5176/canary.svg#paint)" filter="u\000072l(https://evil.test/filter#f)" stroke="url(\68ttp://evil.test/stroke)" style="fill:u\72l(http://evil.test/style)"/><path fill="url(#paint)" stroke="rgb(1, 2, 3)"/><use href="#paint"/></svg>`;
    const mounted = sanitizeSvg(source);
    const exported = sanitizeSvg(mounted);
    for (const value of [mounted, exported, htmlPreviewDocument(source)]) {
      expect(value).not.toMatch(/canary|evil|\\72|\\000072|\\68|127\.0\.0\.1/);
      expect(value).toContain('fill="url(#paint)"');
      expect(value).toContain('stroke="rgb(1, 2, 3)"');
    }
  });
  it("creates a tokenless sandbox document with immutable CSP and no content resources", () => {
    const value = htmlPreviewDocument(
      '<meta http-equiv="Content-Security-Policy" content="default-src *"><meta http-equiv="refresh" content="0;url=https://evil.test"><base href="https://evil.test"><style>@import "https://evil.test";</style><b style="color:red">HTML preview</b><script>alert(1)</script><img src="http://127.0.0.1:8765/health"><a href="https://evil.test">link</a><form action="https://evil.test"><input autofocus></form><svg><a href="https://evil.test">svg</a></svg>',
    );
    expect(value).toContain("default-src 'none'");
    expect(value).toContain("HTML preview");
    expect(value).toContain("color: red");
    expect(value).not.toMatch(
      /evil\.test|127\.0\.0\.1|<script|<base|<form|<input|http-equiv="refresh"/i,
    );
    expect((value.match(/http-equiv=/g) ?? []).length).toBe(1);
  });
  it("allows inline chart data and rejects nested resource and computed navigation fields", () => {
    expect(() =>
      assertInlineChart({ data: { values: [{ x: 1, y: 2 }] }, mark: "bar" }),
    ).not.toThrow();
    for (const value of [
      { data: { url: "http://127.0.0.1:8765/health" } },
      { layer: [{ mark: "image" }] },
      { marks: [{ type: "image" }] },
      {
        marks: [
          {
            encode: {
              update: { href: { signal: "'https:' + '//evil.test'" } },
            },
          },
        ],
      },
      { data: { values: [{ nested: { url: "file:///a" } }] } },
    ])
      expect(() => assertInlineChart(value)).toThrow();
  });
  it("rejects Mermaid content configuration and interactive directives", () => {
    expect(() =>
      assertSafeMermaid("graph TD\n A[Start] --> B[Done]"),
    ).not.toThrow();
    for (const value of [
      '%%{init: {"securityLevel":"loose"}}%%\ngraph TD\nA-->B',
      "---\nconfig:\n securityLevel: loose\n---\ngraph TD\nA-->B",
      'graph TD\nA-->B\nclick A "https://evil.test"',
      "graph TD\nA-->B\nclassDef x fill:url(http://127.0.0.1:8765/health)",
    ])
      expect(() => assertSafeMermaid(value)).toThrow();
  });
});
