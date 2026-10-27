// Token grammar and presentation translated from pinned Open WebUI. See frontend LICENSE.
import { Marked, type MarkedExtension, type Token } from "marked";
import details from "./baseline-extension";
import math from "./baseline-katex-extension";
import colon from "./baseline-colon-fence-extension";
import footnote from "./baseline-footnote-extension";
import citation from "./baseline-citation-extension";
import { disableSingleTilde } from "./baseline-strikethrough-extension";
export interface RichToken {
  type: string;
  raw: string;
  ids?: number[];
  text?: string;
  tokens?: RichToken[];
  lang?: string;
  codeBlockStyle?: "indented";
  depth?: number;
  href?: string;
  title?: string | null;
  displayMode?: boolean;
  ordered?: boolean;
  start?: number;
  items?: RichToken[];
  task?: boolean;
  checked?: boolean;
  loose?: boolean;
  summary?: string;
  fenceType?: string;
  attributes?: Record<string, string>;
  header?: RichToken[];
  rows?: RichToken[][];
  align?: (string | null)[];
}
function markdownParser(): Marked {
  const configured = new Marked();
  for (const extension of [
    math(),
    details(),
    citation(),
    footnote(),
    colon(),
    disableSingleTilde,
  ])
    configured.use(extension as MarkedExtension);
  return configured;
}
const parser = markdownParser();
export function parseMarkdown(value: string): RichToken[] {
  return parser.lexer(value) as unknown as RichToken[];
}
export function parseInline(value: string): RichToken[] {
  return parser.Lexer.lexInline(
    value,
    parser.defaults,
  ) as unknown as RichToken[];
}
export function isFencedCode(token: RichToken): boolean {
  return token.type === "code" && token.codeBlockStyle !== "indented";
}

/** Mirror Marked's newline/leading-tab normalization while retaining original offsets. */
function lexicalSource(content: string): { value: string; offsets: number[] } {
  let value = "";
  const offsets = [0];
  let indent: "spaces" | "tabs" | "body" = "spaces";
  for (let index = 0; index < content.length; index++) {
    const char = content[index];
    if (char === "\r" || char === "\n") {
      if (char === "\r" && content[index + 1] === "\n") index++;
      value += "\n";
      offsets.push(index + 1);
      indent = "spaces";
    } else if (char === "\t" && indent !== "body") {
      value += "    ";
      offsets.push(index, index, index, index + 1);
      indent = "tabs";
    } else {
      value += char;
      offsets.push(index + 1);
      if (char !== " " || indent === "tabs") indent = "body";
    }
  }
  return { value, offsets };
}

/** Capture consumed root spans during lexing, including skipped link definitions. */
function rootFences(source: string): { token: RichToken; start: number }[] {
  const result: ReturnType<typeof rootFences> = [];
  // Marked's override wrappers bind their tokenizer instance. Use an isolated
  // configured lexer rather than mutating the presentation parser's callbacks.
  const configured = markdownParser();
  const tokenizer = configured.defaults.tokenizer!;
  const lexer = new configured.Lexer(configured.defaults);
  let depth = 0;
  const blocks = lexer.blockTokens.bind(lexer);
  lexer.blockTokens = ((value: string, tokens?: Token[]) => {
    depth++;
    try {
      return blocks(value, tokens);
    } finally {
      depth--;
    }
  }) as typeof lexer.blockTokens;
  const fences = tokenizer.fences.bind(tokenizer);
  tokenizer.fences = (remaining) => {
    const token = fences(remaining);
    if (token && depth === 1)
      result.push({ token, start: source.length - remaining.length });
    return token;
  };
  lexer.lex(source);
  return result;
}

/** Resolve root lexical fences only, excluding code inside lists/quotes/extensions. */
export function fenceLocations(content: string): {
  start: number;
  end: number;
  prefix: string;
  suffix: string;
  text: string;
}[] {
  const result: ReturnType<typeof fenceLocations> = [];
  const { value, offsets } = lexicalSource(content);
  for (const { token, start } of rootFences(value)) {
    const cursor = start + token.raw.length;
    const open = /^ {0,3}(`{3,}|~{3,})[^\n]*(?:\n|$)/.exec(token.raw);
    if (!open) continue;
    const closing = new RegExp(
      `^ {0,3}${open[1][0]}{${open[1].length},}[ \\t]*(?:\\n|$)`,
      "gm",
    );
    closing.lastIndex = open[0].length;
    const close = closing.exec(token.raw);
    const bodyEnd = start + (close?.index ?? token.raw.length);
    const textEnd = value[bodyEnd - 1] === "\n" ? bodyEnd - 1 : bodyEnd;
    const from = offsets[start + open[0].length];
    result.push({
      start: offsets[start],
      end: offsets[cursor],
      prefix: content.slice(offsets[start], from),
      suffix: content.slice(offsets[textEnd], offsets[cursor]),
      text: content.slice(from, offsets[textEnd]),
    });
  }
  return result;
}
export function rewriteFence(
  content: string,
  ordinal: number,
  value: string,
): string {
  const fence = fenceLocations(content)[ordinal];
  if (!fence) return content;
  return (
    content.slice(0, fence.start) +
    fence.prefix +
    value +
    fence.suffix +
    content.slice(fence.end)
  );
}
