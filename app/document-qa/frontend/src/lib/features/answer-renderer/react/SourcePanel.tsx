import { useI18n } from "@/react/i18n";
import { useEffect, useId, useState } from "react";
import type { SourcePanelProps } from "../../react-contracts/rendering";
import type { Citation, Immutable } from "../../react-contracts/wire";
import {
  useDocumentViewer,
  useLibrary,
  useServices,
} from "../../../../react/providers";
import {
  Button,
  IconBook,
  IconButton,
  IconFile,
  IconOpenPage,
  IconX,
  Popover,
  pageLabel,
} from "@/lib/features/design-system/react";
import { workspaceVoice } from "../../personality/presentation";

function sourceName(citation: Immutable<Citation>): string {
  const pages =
    citation.page_start === citation.page_end
      ? `p. ${citation.page_start}`
      : `pp. ${citation.page_start}–${citation.page_end}`;
  return `${citation.document_title} · ${pages}`;
}

/** "N sources · M documents" (counted from the validated citations, never from edited text). */
export function sourceSummary(
  citations: readonly Immutable<Citation>[],
  t: ReturnType<typeof useI18n>["t"],
): string {
  const docs = new Set(citations.map((c) => c.document_id)).size;
  const sources =
    citations.length === 1
      ? t("1 Source")
      : t("{{COUNT}} Sources", { COUNT: citations.length });
  return `${sources} · ${docs} ${docs === 1 ? "document" : "documents"}`;
}

/**
 * "Show document page". Loads nothing itself: the shared document viewer calls `load()` only once
 * it is shown. Uses runtime hooks, so it renders only when the answer has a collection version.
 */
function ShowDocumentPage({
  citation,
  version,
  anchor,
  onOpen,
}: {
  citation: Immutable<Citation>;
  version: string;
  anchor: HTMLElement | null;
  onOpen: () => void;
}) {
  const viewer = useDocumentViewer();
  const { answering } = useServices();
  const library = useLibrary();
  const versions = library.state.versions;
  // Only claim removal when the library listing is loaded and no version still holds the document.
  const removed =
    versions.length > 0 &&
    !versions.some((v) =>
      v.documents?.some((d) => d.document_id === citation.document_id),
    );
  if (removed)
    return (
      <p className="qa-cite-missing">
        <IconFile size={14} />
        <span>
          This document was removed from your library. The quote was saved
          with the answer, but the page can’t be shown.
        </span>
      </p>
    );
  return (
    <Button
      variant="secondary"
      size="sm"
      icon={<IconOpenPage size={16} />}
      onClick={() => {
        onOpen();
        viewer.open({
          title: citation.document_title,
          subtitle: pageLabel(citation.page_start, citation.page_end),
          page: citation.page_start,
          citation,
          load: () => answering.fetchSource(citation.document_id, version),
          returnFocus: anchor,
        });
      }}
    >
      {workspaceVoice.showDocumentPage}
    </Button>
  );
}

/** Quote-first, non-modal citation pop-up; the exact quote is plain, untrusted text. */
function CitationPopover({
  citation,
  index,
  anchor,
  collectionVersion,
  onClose,
}: {
  citation: Immutable<Citation>;
  index: number;
  anchor: HTMLElement | null;
  collectionVersion?: string | null;
  onClose: (refocus: boolean) => void;
}) {
  const { t } = useI18n();
  const titleId = useId();
  return (
    <Popover
      anchor={anchor}
      open
      onClose={(reason) => onClose(reason !== "outside" && reason !== "escape")}
      labelledBy={titleId}
      side="bottom"
      align="start"
      className="qa-cite-popover source-quote-popover"
    >
      <div className="qa-cite-head">
        <span className="qa-cite-index" aria-hidden="true">
          {index + 1}
        </span>
        <div className="qa-cite-meta">
          <h2 id={titleId} className="qa-cite-title">
            {citation.document_title}
          </h2>
          <p className="qa-cite-pages">
            {pageLabel(citation.page_start, citation.page_end)}
          </p>
        </div>
        <IconButton
          size="sm"
          tooltip={false}
          label={t("Close source quote")}
          icon={<IconX size={16} />}
          onClick={() => onClose(true)}
        />
      </div>
      <figure className="qa-source-quote">
        <figcaption className="ui-eyebrow">Original text</figcaption>
        <blockquote>{citation.quote}</blockquote>
      </figure>
      {collectionVersion != null && (
        <div className="qa-cite-foot">
          <ShowDocumentPage
            citation={citation}
            version={collectionVersion}
            anchor={anchor}
            onOpen={() => onClose(false)}
          />
        </div>
      )}
    </Popover>
  );
}

export function SourcePanel({
  citations,
  citationAnchor,
  collectionVersion,
  expanded,
  openCitation,
  onCloseCitation,
  onExpandedChange,
}: SourcePanelProps) {
  const { t } = useI18n();
  const listId = useId();
  const [selected, setSelected] = useState<{
    index: number;
    anchor: HTMLElement | null;
  } | null>(null);
  useEffect(() => {
    if (openCitation != null && citations[openCitation - 1])
      setSelected({ index: openCitation - 1, anchor: citationAnchor ?? null });
    else if (openCitation == null) setSelected((s) => (s && s.anchor === citationAnchor ? null : s));
  }, [openCitation, citationAnchor, citations]);
  const close = (refocus: boolean) => {
    const anchor = selected?.anchor;
    setSelected(null);
    onCloseCitation?.();
    if (refocus) anchor?.focus({ preventScroll: true });
  };
  if (!citations.length) return null;
  const current = selected ? citations[selected.index] : null;
  return (
    <>
      <div className="qa-sources-bar">
        <button
          type="button"
          className="qa-sources-toggle"
          aria-expanded={expanded}
          aria-controls={expanded ? listId : undefined}
          onClick={() => onExpandedChange(!expanded)}
        >
          <IconBook size={15} />
          {sourceSummary(citations, t)}
        </button>
      </div>
      {expanded && (
        <ol id={listId} className="qa-sources-list">
          {citations.map((citation, index) => (
            <li key={citation.citation_id}>
              <button
                type="button"
                className="qa-source-row"
                aria-haspopup="dialog"
                aria-expanded={selected?.index === index}
                aria-label={t("View source: {{name}}", {
                  name: sourceName(citation),
                })}
                onClick={(event) => {
                  const anchor = event.currentTarget;
                  setSelected((s) =>
                    s?.index === index && s.anchor === anchor
                      ? null
                      : { index, anchor },
                  );
                }}
              >
                <span className="qa-cite qa-cite-static" aria-hidden="true">
                  {index + 1}
                </span>
                <span className="qa-source-row-title">
                  {citation.document_title}
                </span>
                <span className="qa-source-row-pages">
                  {pageLabel(citation.page_start, citation.page_end)}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
      {selected && current && (
        <CitationPopover
          key={`${selected.index}`}
          citation={current}
          index={selected.index}
          anchor={selected.anchor}
          collectionVersion={collectionVersion}
          onClose={close}
        />
      )}
    </>
  );
}
