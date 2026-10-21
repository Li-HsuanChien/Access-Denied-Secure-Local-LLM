import { describe, expect, it } from "vitest";
import {
  readDraftText,
  writeDraftText,
  serializeDraftForSubmit,
} from "./draftText";

const element = (html: string) => {
  const node = document.createElement("div");
  node.innerHTML = html;
  return node;
};
describe("plain draft DOM boundary", () => {
  it("counts native and rich editor paragraph boundaries without counting placeholder BR twice", () => {
    for (const html of [
      "first<div><br></div><div>third</div>",
      "<p>first</p><p><br></p><p>third</p>",
      '<p>first</p><p><br class="ProseMirror-trailingBreak"></p><p>third</p>',
    ])
      expect(readDraftText(element(html))).toBe("first\n\nthird");
  });
  it("preserves leading, trailing and consecutive newlines, spaces, tabs and inline breaks", () => {
    for (const draft of [
      "",
      "\n",
      "\n\n",
      "\nfirst\n",
      "first\n\nthird\n\n",
      "  first\t  \n third  ",
    ]) {
      const node = document.createElement("div");
      writeDraftText(node, draft);
      expect(readDraftText(node)).toBe(draft);
    }
    expect(readDraftText(element("first<br><br>third"))).toBe("first\n\nthird");
    expect(readDraftText(element("<div><br></div><div>third</div>"))).toBe(
      "\nthird",
    );
    expect(readDraftText(element("<div>first</div><div><br></div>"))).toBe(
      "first\n",
    );
  });
  it("writes draft text as text nodes without interpreting markup", () => {
    const node = document.createElement("div");
    writeDraftText(node, '<img src=x onerror="bad()">\nnext');
    expect(node.querySelector("img")).toBeNull();
    expect(readDraftText(node)).toBe('<img src=x onerror="bad()">\nnext');
  });
});

it("matches observed original submission whitespace without changing the semantic draft", () => {
  const cases = [
    ["first\nthird", "first\nthird"],
    ["first\n\nthird", "first\n  \nthird"],
    ["\nfirst\nthird", "  \nfirst\nthird"],
    ["first\nthird\n\n", "first\nthird"],
    ["first\n\n\nthird", "first\n  \n  \nthird"],
  ];
  for (const [draft, question] of cases)
    expect(serializeDraftForSubmit(draft)).toBe(question);
});
