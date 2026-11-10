// Native Chat Markdown presentation translated from pinned Open WebUI; see frontend LICENSE.
import {
  createElement,
  Fragment,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useI18n } from "@/react/i18n";
import { Slide } from "./motion";
import { decode } from "html-entities";
import katex from "katex";
import "katex/contrib/mhchem";
import "katex/dist/katex.min.css";
import type { ChatAnswerProps } from "../../react-contracts/rendering";
import {
  parseMarkdown,
  parseInline,
  rewriteFence,
  isFencedCode,
  type RichToken,
} from "./markdown";
import { safeAppPath } from "./security";
import { copyText, downloadText, tableCsv } from "./exports";
import { CodeBlock } from "./CodeBlock";
import { Icon } from "./Icon";
import { PreviewPane } from "./PreviewPane";
import { SourcePanel } from "./SourcePanel";
import { useTooltips } from "./useTooltips";
import { pageLabel } from "@/lib/features/design-system/react";
import "./renderer.css";

const alertThemes: Record<
  string,
  {
    border: string;
    text: string;
    icon: "info" | "bulb" | "star" | "warning" | "bolt";
  }
> = {
  NOTE: { border: "border-sky-500", text: "text-sky-500", icon: "info" },
  TIP: { border: "border-emerald-500", text: "text-emerald-500", icon: "bulb" },
  IMPORTANT: {
    border: "border-purple-500",
    text: "text-purple-500",
    icon: "star",
  },
  WARNING: {
    border: "border-yellow-500",
    text: "text-yellow-500",
    icon: "warning",
  },
  CAUTION: { border: "border-rose-500", text: "text-rose-500", icon: "bolt" },
};
function MathToken({ token }: { token: RichToken }) {
  const source = token.text ?? "";
  let html: string;
  try {
    html = katex.renderToString(source, {
      displayMode: token.displayMode ?? false,
      throwOnError: false,
      trust: false,
      maxExpand: 1000,
      maxSize: 100,
      macros: {},
    });
  } catch {
    return source;
  }
  return createElement(token.displayMode ? "div" : "span", {
    className: "cursor-pointer",
    onClick: () => {
      void copyText(source);
    },
    dangerouslySetInnerHTML: { __html: html },
  });
}
function RawHtml({ text }: { text: string }) {
  if (/<iframe\b|<file\s+type="html"/i.test(text))
    return (
      <div
        title={
          /youtube\.com\/embed\//.test(text)
            ? "YouTube video player"
            : "Embedded content"
        }
        className={`renderer-blocked-frame w-full my-2 ${/youtube\.com\/embed\//.test(text) ? "aspect-video" : ""}`}
        aria-label="Embedded content unavailable"
      >
        <svg aria-hidden="true" viewBox="0 0 32 40" width="32" height="40">
          <path
            d="M2 2h20l8 8v28H2Z M22 2v9h8 M10 10v5 M20 13v5 M9 29l3-3h7l3 3"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          />
        </svg>
      </div>
    );
  if (/^<br\s*\/?>$/i.test(text.trim())) return <br />;
  return <>{text}</>;
}
function Writing({
  token,
  children,
}: {
  token: RichToken;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const attributes = token.attributes ?? {},
    label =
      attributes.subject ||
      (token.fenceType ?? "default")
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase()),
    header = attributes.recipient
      ? `${label} · ${attributes.recipient}`
      : label;
  return (
    <div className="relative group my-2 rounded-2xl qa-writing px-4 py-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span
          className="text-xs font-normal qa-muted truncate"
          dir="auto"
          title={header}
        >
          {header}
        </span>
        <button
          type="button"
          title={copied ? t("Copied") : t("Copy")}
          aria-label={copied ? t("Copied") : t("Copy")}
          className="hover-reveal p-1 rounded-lg bg-transparent hover:bg-black/5 dark:hover:bg-white/5 transition"
          onClick={() => {
            void copyText(token.text ?? "").then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1000);
            });
          }}
        >
          <Icon
            name={copied ? "check" : "duplicate"}
            className="size-3.5"
            strokeWidth={1.5}
          />
        </button>
      </div>
      <div className="prose-sm" dir="auto">
        {children}
      </div>
    </div>
  );
}
function Detail({
  token,
  children,
}: {
  token: RichToken;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="w-full space-y-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="qa-details-toggle py-0.5 transition block text-start disabled:cursor-default"
      >
        <div className="w-full flex items-center justify-between gap-2">
          <div>{token.summary}</div>
          <div className="flex self-center translate-y-[1px]">
            <svg
              className="size-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.75"
            >
              <path
                d={
                  open
                    ? "m4.5 15.75 7.5-7.5 7.5 7.5"
                    : "m19.5 8.25-7.5 7.5-7.5-7.5"
                }
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>
      </button>
      <Slide open={open}>
        <div className="mb-1.5">{children}</div>
      </Slide>
    </div>
  );
}
export function MarkdownContent({
  content,
  onNavigate,
  onSaveContent,
  onPreview,
  className = "markdown-prose",
  onCitation,
  citationLabel,
  activeCitation,
}: {
  className?: string;
  onCitation?: (index: number, anchor: HTMLElement) => void;
  /** Accessible name for inline citation chip `index` (one-based). */
  citationLabel?: (index: number) => string;
  /** One-based citation whose pop-up is open, for aria-expanded. */
  activeCitation?: number | null;
  content: string;
  onNavigate: ChatAnswerProps["onNavigate"];
  onSaveContent: ChatAnswerProps["onSaveContent"];
  onPreview: (kind: "html" | "svg", source: string) => void;
}) {
  const { t } = useI18n();
  const tokens = useMemo(() => parseMarkdown(content), [content]);
  let fenceOrdinal = 0;
  const inline = (parts: RichToken[] = []): ReactNode =>
    parts.map((token, index) => {
      const children = () => inline(token.tokens ?? []);
      let rendered: ReactNode;
      switch (token.type) {
        case "strong":
          rendered = <strong>{children()}</strong>;
          break;
        case "em":
          rendered = <em>{children()}</em>;
          break;
        case "del":
          rendered = <del>{children()}</del>;
          break;
        case "underline":
          rendered = <u>{children()}</u>;
          break;
        case "codespan":
          rendered = (
            <code
              className="codespan cursor-pointer"
              onClick={() => {
                void copyText(decode(token.text ?? ""));
              }}
            >
              {decode(token.text ?? "")}
            </code>
          );
          break;
        case "inlineKatex":
          rendered = <MathToken token={token} />;
          break;
        case "citation":
          rendered = <>{(token.ids as number[] ?? []).map(id => (
            <button
              key={id}
              type="button"
              className="citation-ref qa-cite"
              aria-haspopup="dialog"
              aria-expanded={activeCitation === id}
              data-open={activeCitation === id || undefined}
              aria-label={citationLabel?.(id) ?? `View citation ${id}`}
              onClick={(event) => onCitation?.(id, event.currentTarget)}
            >
              {id}
            </button>
          ))}</>;
          break;
        case "footnote":
          rendered = (
            <sup className="footnote-ref footnote-ref-text">{token.text}</sup>
          );
          break;
        case "br":
          rendered = <br />;
          break;
        case "escape":
          rendered = decode(token.text ?? "");
          break;
        case "html":
          rendered = <RawHtml text={token.text ?? token.raw} />;
          break;
        case "image":
          rendered = (
            <span className="relative group w-fit flex items-center">
              <span
                className="qa-image-unavailable rounded-lg inline-flex h-[1.6875rem] min-w-8 gap-1.5 px-2 items-center justify-center overflow-hidden"
                data-cy="image-unavailable"
              >
                <Icon
                  name="photo"
                  className="size-3.5 shrink-0"
                  strokeWidth={1.5}
                />
                <span className="truncate text-xs">Image unavailable</span>
              </span>
            </span>
          );
          break;
        case "link": {
          const path = safeAppPath(token.href ?? "");
          rendered = (
            <a
              href={path ?? undefined}
              title={token.title ?? undefined}
              onClick={(event) => {
                event.preventDefault();
                if (path) onNavigate(path);
              }}
            >
              {token.tokens ? children() : token.text}
            </a>
          );
          break;
        }
        default:
          rendered = token.raw ?? token.text ?? "";
      }
      return <Fragment key={index}>{rendered}</Fragment>;
    });
  const blocks = (parts: RichToken[], top = true): ReactNode =>
    parts.map((token, index) => {
      let rendered: ReactNode;
      switch (token.type) {
        case "space":
          rendered = null;
          break;
        case "hr":
          rendered = <hr />;
          break;
        case "heading":
          rendered = createElement(
            `h${token.depth ?? 1}`,
            { dir: "auto" },
            inline(token.tokens),
          );
          break;
        case "paragraph":
          rendered = (
            <p dir="auto" className={parts.length === 1 ? "!my-0" : ""}>
              {inline(token.tokens)}
            </p>
          );
          break;
        case "text":
          rendered = top ? (
            <p dir="auto">{token.tokens ? inline(token.tokens) : token.text}</p>
          ) : token.tokens ? (
            inline(token.tokens)
          ) : (
            token.text
          );
          break;
        case "code": {
          const fenced = isFencedCode(token);
          // Original recursive Markdown instances save editor-local only.
          const ordinal = fenced && parts === tokens ? fenceOrdinal++ : null;
          rendered = fenced ? (
            <CodeBlock
              source={token.text ?? ""}
              language={(token.lang ?? "").trim().toLowerCase()}
              onSave={(value) => {
                if (ordinal !== null)
                  onSaveContent(rewriteFence(content, ordinal, value));
              }}
              onPreview={onPreview}
            />
          ) : (
            token.text
          );
          break;
        }
        case "blockquote": {
          const alert = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*\n*/.exec(
            token.text ?? "",
          );
          rendered = alert ? (
            <div
              className={`renderer-alert border-l-4 pl-2.5 my-0.5 ${alertThemes[alert[1]].border}`}
            >
              <div
                className={`${alertThemes[alert[1]].text} renderer-alert-title items-center flex gap-1 py-1.5`}
              >
                <Icon
                  name={alertThemes[alert[1]].icon}
                  className="inline-block size-4"
                  strokeWidth={1.5}
                />
                <span className="font-normal">{alert[1]}</span>
              </div>
              <div className="pb-2">
                {blocks(
                  parseMarkdown((token.text ?? "").slice(alert[0].length)),
                )}
              </div>
            </div>
          ) : (
            <blockquote dir="auto">{blocks(token.tokens ?? [])}</blockquote>
          );
          break;
        }
        case "list": {
          const children = (token.items ?? []).map((item, itemIndex) => (
            <li
              key={itemIndex}
              className={`text-start ${item.task && !token.ordered ? "flex -translate-x-6.5 gap-3" : ""}`}
            >
              {item.task && (
                <input
                  type="checkbox"
                  className="flex-shrink-0"
                  defaultChecked={item.checked}
                />
              )}
              <div>{blocks(item.tokens ?? [], item.loose ?? false)}</div>
            </li>
          ));
          rendered = token.ordered ? (
            <ol start={token.start || 1} dir="auto">
              {children}
            </ol>
          ) : (
            <ul dir="auto">{children}</ul>
          );
          break;
        }
        case "table":
          rendered = (
            <div className="relative w-full group mb-2">
              <div className="scrollbar-hidden relative overflow-x-auto max-w-full">
                <table
                  className="qa-table w-full text-sm text-start max-w-full rounded-xl"
                  dir="auto"
                >
                  <thead className="text-xs uppercase border-none">
                    <tr>
                      {(token.header ?? []).map((cell, i) => (
                        <th
                          key={i}
                          scope="col"
                          className="px-2.5! py-2! cursor-pointer"
                          style={
                            {
                              textAlign: token.align?.[i] ?? undefined,
                            } as CSSProperties
                          }
                        >
                          <div className="gap-1.5 text-start">
                            <div className="shrink-0 break-normal">
                              {inline(cell.tokens)}
                            </div>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(token.rows ?? []).map((row, r) => (
                      <tr key={r} className="text-xs">
                        {row.map((cell, c) => (
                          <td
                            key={c}
                            className={`px-3! py-2! w-max ${r === (token.rows ?? []).length - 1 ? "qa-last-row" : ""}`}
                            style={
                              {
                                textAlign: token.align?.[c] ?? undefined,
                              } as CSSProperties
                            }
                          >
                            <div className="break-normal">
                              {inline(cell.tokens)}
                            </div>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="absolute top-1 right-1.5 z-20 hover-reveal flex gap-0.5">
                <button
                  type="button"
                  title={t("Copy")}
                  aria-label="Copy table"
                  className="p-1 rounded-lg bg-transparent transition"
                  onClick={() => {
                    void copyText(token.raw.trim());
                  }}
                >
                  <Icon name="copy" className="size-3.5" strokeWidth={1.5} />
                </button>
                <button
                  type="button"
                  title={t("Export to CSV")}
                  aria-label={t("Export to CSV")}
                  className="p-1 rounded-lg bg-transparent transition"
                  onClick={() =>
                    downloadText(
                      tableCsv(token),
                      `table-${index}.csv`,
                      "text/csv;charset=UTF-8",
                    )
                  }
                >
                  <Icon
                    name="download"
                    className="size-3.5"
                    strokeWidth={1.5}
                  />
                </button>
              </div>
            </div>
          );
          break;
        case "colonFence":
          rendered = (
            <Writing token={token}>{blocks(token.tokens ?? [])}</Writing>
          );
          break;
        case "details":
          rendered = (
            <Detail token={token}>
              {blocks(parseMarkdown(decode(token.text ?? "")))}
            </Detail>
          );
          break;
        case "html":
          rendered = <RawHtml text={token.text ?? token.raw} />;
          break;
        case "blockKatex":
          rendered = <MathToken token={token} />;
          break;
        default:
          rendered = inline([token]);
      }
      return <Fragment key={index}>{rendered}</Fragment>;
    });
  return <div className={className}>{blocks(tokens)}</div>;
}
export function ChatAnswer({
  messageId,
  content,
  citations,
  collectionVersion,
  onNavigate,
  onSaveContent,
}: ChatAnswerProps) {
  const tooltipRoot = useTooltips<HTMLDivElement>();
  const [citationAnchor, setCitationAnchor] = useState<HTMLElement | null>(null);
  const [openCitation, setOpenCitation] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false),
    [preview, setPreview] = useState<{
      kind: "html" | "svg";
      source: string;
    } | null>(null);
  return (
    <div
      ref={tooltipRoot}
      className="renderer-answer"
      data-message-id={messageId}
    >
      <MarkdownContent
        className="markdown-prose qa-prose"
        content={content}
        onNavigate={onNavigate}
        onSaveContent={onSaveContent}
        onPreview={(kind, source) => setPreview({ kind, source })}
        activeCitation={openCitation}
        citationLabel={(index) => {
          const c = citations[index - 1];
          return c ? `View citation ${index}: ${c.document_title}, ${pageLabel(c.page_start, c.page_end)}` : `View citation ${index}`;
        }}
        onCitation={(index, anchor) => {
          if (!citations[index - 1]) return;
          // A second press on the same chip closes its pop-up.
          if (openCitation === index && citationAnchor === anchor) { setOpenCitation(null); return; }
          setCitationAnchor(anchor);
          setOpenCitation(index);
        }}
      />
      <SourcePanel
        citations={citations}
        collectionVersion={collectionVersion}
        openCitation={openCitation}
        citationAnchor={citationAnchor}
        onCloseCitation={() => setOpenCitation(null)}
        expanded={expanded}
        onExpandedChange={setExpanded}
      />
      {preview && (
        <PreviewPane
          kind={preview.kind}
          source={preview.source}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}
