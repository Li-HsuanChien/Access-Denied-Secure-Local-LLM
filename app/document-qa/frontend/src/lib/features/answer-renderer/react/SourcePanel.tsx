import { useI18n } from "@/react/i18n";
import { useEffect, useState } from "react";
import type { SourcePanelProps } from "../../react-contracts/rendering";
import type { Citation, Immutable } from "../../react-contracts/wire";
import { PdfSource } from "../../library/react/PdfSource";
import { Modal } from "./Modal";
import { Icon } from "./Icon";
import { MarkdownContent } from "./ChatAnswer";
function sourceName(citation: Immutable<Citation>): string {
  const pages =
    citation.page_start === citation.page_end
      ? `p. ${citation.page_start}`
      : `pp. ${citation.page_start}–${citation.page_end}`;
  return `${citation.document_title} · ${pages}`;
}
export function SourcePanel({
  citations,
  collectionVersion,
  expanded,
  openCitation,
  onCloseCitation,
  onExpandedChange,
}: SourcePanelProps) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<Immutable<Citation> | null>(null);
  useEffect(() => { if (openCitation != null && citations[openCitation - 1]) setSelected(citations[openCitation - 1]); }, [openCitation, citations]);
  const close = () => { setSelected(null); onCloseCitation?.(); };
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
                onClick={() => setSelected(citation)}
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
      {selected && (
        <Modal label={sourceName(selected)} onClose={close}>
          <div>
            <div className="flex justify-between dark:text-gray-300 px-4.5 pt-3 pb-2">
              <div className="text-sm font-medium self-center flex items-center">
                {sourceName(selected)}
              </div>
              <button
                type="button"
                aria-label={t("Close citation modal")}
                className="self-center rounded-lg p-1 text-gray-500 transition hover:bg-gray-50 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                onClick={close}
              >
                <Icon name="close" strokeWidth={1.5} />
              </button>
            </div>
            {collectionVersion !== undefined && <div className="px-5 pb-3"><PdfSource documentId={selected.document_id} version={collectionVersion} citation={selected} /></div>}
            <div className="flex flex-col md:flex-row w-full px-5 pb-5 md:space-x-4">
              <div className="flex flex-col w-full dark:text-gray-200 overflow-y-scroll max-h-[22rem] scrollbar-thin gap-1">
                <div className="flex flex-col w-full">
                  <div className="text-sm font-normal dark:text-gray-300 flex items-center gap-2 w-fit mb-1">
                    {t("Content")}{" "}
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      (
                      {selected.page_start === selected.page_end
                        ? `${t("page")} ${selected.page_start}`
                        : `pages ${selected.page_start}–${selected.page_end}`}
                      )
                    </span>
                  </div>
                  <div className="text-sm prose dark:prose-invert markdown-prose-sm min-w-full max-w-full">
                    <MarkdownContent
                      className=""
                      content={selected.quote.trim().replace(/\n\n+/g, "\n\n")}
                      onNavigate={() => {}}
                      onSaveContent={() => {}}
                      onPreview={() => {}}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
