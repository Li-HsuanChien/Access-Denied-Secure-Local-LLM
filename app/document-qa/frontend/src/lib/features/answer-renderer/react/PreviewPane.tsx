import { useI18n } from "@/react/i18n";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { htmlPreviewDocument, sanitizeSvg } from "./security";
import { SvgPanZoom } from "./Diagrams";
import { copyText, downloadText } from "./exports";
import { Icon } from "./Icon";
import { useTooltips } from "./useTooltips";
export function PreviewPane({
  kind,
  source,
  onClose,
}: {
  kind: "html" | "svg";
  source: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const tooltipRoot = useTooltips<HTMLElement>();
  const [copied, setCopied] = useState(false),
    [full, setFull] = useState(false);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  const document = kind === "html" ? htmlPreviewDocument(source) : "";
  return createPortal(
    <aside
      ref={tooltipRoot}
      aria-label="Artifact preview"
      className={`renderer-artifact ${full ? "renderer-artifact-full" : ""} w-full h-full flex flex-col bg-white dark:bg-gray-850`}
    >
      <header className="pointer-events-auto z-20 flex justify-between items-center p-2.5 font-primary text-gray-900 dark:text-white">
        <div className="flex-1 flex items-center justify-between pr-1">
          <div className="flex items-center space-x-2">
            <button
              type="button"
              aria-label={t("Previous version")}
              disabled
              className="p-1 disabled:cursor-not-allowed"
            >
              <Icon name="previous" className="size-3.5" strokeWidth={2.5} />
            </button>
            <div className="text-xs self-center dark:text-gray-100 min-w-fit">
              {t("Version {{selectedVersion}} of {{totalVersions}}", {
                selectedVersion: 1,
                totalVersions: 1,
              })}
            </div>
            <button
              type="button"
              aria-label={t("Next version")}
              disabled
              className="p-1 disabled:cursor-not-allowed"
            >
              <Icon name="next" className="size-3.5" strokeWidth={2.5} />
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className="copy-code-button bg-none border-none text-xs bg-gray-50 hover:bg-gray-100 dark:bg-gray-850 dark:hover:bg-gray-800 transition rounded-md px-1.5 py-0.5"
              onClick={() => {
                void copyText(source).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                });
              }}
            >
              {copied ? t("Copied") : t("Copy")}
            </button>
            <button
              type="button"
              title={t("Download")}
              aria-label={t("Download")}
              className="text-xs bg-gray-50 dark:bg-gray-850 rounded-md p-0.5"
              onClick={() =>
                downloadText(
                  kind === "svg"
                    ? sanitizeSvg(source)
                    : htmlPreviewDocument(source),
                  `artifact.${kind}`,
                  kind === "svg" ? "image/svg+xml" : "text/html",
                )
              }
            >
              <Icon name="download" className="size-3.5" strokeWidth={1.5} />
            </button>
            {kind === "html" && (
              <button
                type="button"
                title={t("Open in full screen")}
                aria-label={t("Open in full screen")}
                className="p-0.5"
                onClick={() => setFull(!full)}
              >
                <svg
                  className="size-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M3 3l6 6m12-6-6 6M3 21l6-6m12 6-6-6" />
                </svg>
              </button>
            )}
          </div>
        </div>
        <button
          type="button"
          aria-label="Close artifact"
          className="p-1 rounded-full bg-white dark:bg-gray-850"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </header>
      <div className="flex-1 w-full h-full min-h-0">
        {kind === "html" ? (
          <iframe
            title="HTML preview"
            sandbox=""
            srcDoc={document}
            className="w-full border-0 h-full rounded-none"
          />
        ) : (
          <SvgPanZoom
            svg={source}
            content={source}
            className="h-full overflow-hidden"
          />
        )}
      </div>
    </aside>,
    window.document.body,
  );
}
