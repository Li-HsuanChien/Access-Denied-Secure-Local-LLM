import { describe, expect, it } from "vitest";
import { fenceLocations, parseMarkdown, rewriteFence } from "./markdown";
import { tableCsv } from "./exports";
describe("native content actions", () => {
  it("rewrites only the corresponding repeated fence in the whole transient message", () => {
    const content =
      'Before\n\n```python\nprint("same")\n```\n\nBetween\n\n```python\nprint("same")\n```\n\nAfter';
    expect(rewriteFence(content, 1, 'print("second")')).toBe(
      'Before\n\n```python\nprint("same")\n```\n\nBetween\n\n```python\nprint("second")\n```\n\nAfter',
    );
  });
  it("saves an unfinished final code fence without losing surrounding text", () => {
    expect(rewriteFence('Before\n\n```json\n{"a":1}', 0, '{"a":2}')).toBe(
      'Before\n\n```json\n{"a":2}',
    );
  });
  it("maps only lexical root fences after quotes/lists and between repeated blocks", () => {
    const quoted = "> ```js\n> const quoted = 1;\n> ```\n\n";
    const listed = "- Item\n\n  ```js\n  const listed = 1;\n  ```\n\n";
    const root = "```js\nconst same = 2;\n```\n\n";
    const content = quoted + listed + root + quoted + root;
    expect(fenceLocations(content)).toHaveLength(2);
    expect(rewriteFence(content, 0, "const first = 3;")).toBe(
      quoted + listed + root.replace("same = 2", "first = 3") + quoted + root,
    );
    expect(rewriteFence(content, 1, "const second = 4;")).toBe(
      quoted + listed + root + quoted + root.replace("same = 2", "second = 4"),
    );
  });
  it("preserves legal independent opening/closing indentation and ignores fence-looking indented code", () => {
    const content =
      "    ```js\n    not a fence\n    ```\n\n   ~~~~js\n   const first = 1;\n ~~~~~\n\n```js\nconst second = 2;\n```";
    expect(fenceLocations(content)).toHaveLength(2);
    expect(rewriteFence(content, 0, "const edited = 3;")).toBe(
      content.replace("   const first = 1;", "const edited = 3;"),
    );
    expect(rewriteFence(content, 1, "const edited = 4;")).toBe(
      content.replace("const second = 2;", "const edited = 4;"),
    );
  });
  it("keeps surrounding original line endings and tabs when locating a root fence", () => {
    const content =
      "> ```js\r\n> quoted\r\n> ```\r\n\r\n```js\r\n\tconst old = 1;\r\n```\r\n\r\nAfter";
    expect(rewriteFence(content, 0, "const newValue = 2;")).toBe(
      content.replace("\tconst old = 1;", "const newValue = 2;"),
    );
  });
  it("does not mistake identical fenced text in a skipped link definition for the root code token", () => {
    const definition = '[ref]: /x "title\n```js\nconst same = 1;\n```\n"\n\n';
    const root = "```js\nconst same = 1;\n```\n";
    expect(rewriteFence(definition + root, 0, "const changed = 2;")).toBe(
      definition + root.replace("const same = 1;", "const changed = 2;"),
    );
  });
  it("exports quoted CSV with BOM, decoded entities and quote escaping", () => {
    const token = parseMarkdown(
      '| A &amp; B | Name |\n| --- | --- |\n| "quoted" | **bold** |',
    )[0];
    expect(tableCsv(token)).toBe('\uFEFF"A & B","Name"\n"""quoted""","bold"');
  });
});
