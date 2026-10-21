/** Native editable blocks and the original rich editor encode one plain draft differently.
 * Read structural paragraph boundaries; browser innerText also counts placeholder BR/layout gaps. */
export function readDraftText(root: Node): string {
  const nodes = Array.from(root.childNodes);
  if (nodes.length === 1 && nodes[0] instanceof HTMLBRElement) return "";
  const paragraphs: string[] = [];
  let inline = "";
  let hasInline = false;
  const flush = () => {
    if (hasInline) paragraphs.push(inline);
    inline = "";
    hasInline = false;
  };
  for (const node of nodes) {
    if (
      node instanceof HTMLElement &&
      (node.tagName === "DIV" || node.tagName === "P")
    ) {
      flush();
      paragraphs.push(readDraftText(node));
    } else if (node instanceof HTMLBRElement) {
      if (!node.classList.contains("ProseMirror-trailingBreak")) {
        inline += "\n";
        hasInline = true;
      }
    } else {
      const text =
        node.nodeType === Node.TEXT_NODE
          ? (node.textContent ?? "")
          : readDraftText(node);
      if (text) {
        inline += text;
        hasInline = true;
      }
    }
  }
  flush();
  return paragraphs.join("\n");
}

/** Write text nodes only; retain empty paragraphs and their exact newline positions. */
export function writeDraftText(root: HTMLElement, draft: string): void {
  root.replaceChildren(
    ...draft.split("\n").map((line) => {
      const paragraph = document.createElement("p");
      if (line) paragraph.textContent = line;
      else paragraph.append(document.createElement("br"));
      return paragraph;
    }),
  );
}

/** Original RichTextInput's single-newline paragraphs + Turndown BR/postProcess result.
 * Apply only at typed-composer submission; raw suggestion/edit/regenerate pathways are unchanged. */
export function serializeDraftForSubmit(draft: string): string {
  return draft
    .split("\n")
    .map((line) => (line === "" ? "  " : line))
    .join("\n")
    .replace(/[\t\r\n\s]+$/, "");
}
