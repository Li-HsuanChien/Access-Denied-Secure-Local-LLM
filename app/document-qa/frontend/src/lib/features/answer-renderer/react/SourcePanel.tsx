import { useI18n } from "@/react/i18n";
import { useEffect, useState } from "react";
import type { SourcePanelProps } from "../../react-contracts/rendering";
import type { Citation, Immutable } from "../../react-contracts/wire";
import { PdfSource } from "../../library/react/PdfSource";
import { Modal } from "./Modal";
import { Icon } from "./Icon";
import { QuotePopover } from "./QuotePopover";
function sourceName(citation: Immutable<Citation>): string {
  const pages =
    citation.page_start === citation.page_end
      ? `p. ${citation.page_start}`
      : `pp. ${citation.page_start}–${citation.page_end}`;
  return `${citation.document_title} · ${pages}`;
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
  const [selected, setSelected] = useState<Immutable<Citation> | null>(null);
  useEffect(() => {
    if (openCitation != null && citations[openCitation - 1])
      setSelected(citations[openCitation - 1]);
  }, [openCitation, citations]);
  const [showPage, setShowPage] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (openCitation != null) {
      setAnchor(citationAnchor ?? null);
      setShowPage(false);
    }
  }, [openCitation, citationAnchor]);
  const close = () => {
    setSelected(null);
    setShowPage(false);
    onCloseCitation?.();
    anchor?.focus();
  };
  const selectedName = selected ? sourceName(selected) : "";
  const quote = selected && (
    <>
      <div className="source-quote-heading">
        <strong>{selectedName}</strong>
        <button
          type="button"
          aria-label={t("Close source quote")}
          onClick={close}
        >
          <Icon name="close" />
        </button>
      </div>
      <p className="source-quote-label">{t("Exact source text")}</p>
      <blockquote className="source-quote-text">{selected.quote}</blockquote>
      {collectionVersion != null && (
        <button
          type="button"
          className="source-page-action"
          onClick={() => setShowPage(!showPage)}
        >
          {t(showPage ? "Hide document page" : "Show document page")}
        </button>
      )}
    </>
  );
  if (!citations.length) return null;
  return (
    <>
      <div className="py-1 -mx-0.5 w-full flex gap-1 items-center flex-wrap">
        <button
          type="button"
          className="text-xs font-normal text-gray-600 dark:text-gray-300 px-3.5 h-8 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition flex items-center gap-1 border border-gray-50 dark:border-gray-850/30"
          aria-label={
            citations.length === 1
              ? t("Toggle 1 source")
              : t("Toggle {{COUNT}} sources", { COUNT: citations.length })
          }
          aria-expanded={expanded}
          onClick={() => onExpandedChange(!expanded)}
        >
          <div>
            {citations.length === 1
              ? t("1 Source")
              : t("{{COUNT}} Sources", { COUNT: citations.length })}
          </div>
        </button>
      </div>
      {expanded && (
        <div className="py-1.5">
          <div className="text-xs gap-2 flex flex-col">
            {citations.map((citation, index) => (
              <button
                type="button"
                key={citation.citation_id}
                aria-label={t("View source: {{name}}", {
                  name: sourceName(citation),
                })}
                className="no-toggle outline-hidden flex dark:text-gray-300 bg-transparent text-gray-600 rounded-xl gap-1.5 items-center"
                onClick={(event) => {
                  setAnchor(event.currentTarget);
                  setShowPage(false);
                  setSelected(citation);
                }}
              >
                <div className="font-normal bg-gray-50 dark:bg-gray-850 rounded-md px-1">
                  {index + 1}
                </div>
                <div className="flex-1 truncate hover:text-black dark:text-white/60 dark:hover:text-white transition text-left">
                  {sourceName(citation)}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
      {selected && !showPage && (
        <QuotePopover anchor={anchor} label={selectedName} onClose={close}>
          {quote}
        </QuotePopover>
      )}
      {selected && showPage && (
        <Modal label={selectedName} onClose={close}>
          <div className="source-document-modal">
            {quote}
            {collectionVersion != null && (
              <PdfSource
                documentId={selected.document_id}
                version={collectionVersion}
                citation={selected}
              />
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
