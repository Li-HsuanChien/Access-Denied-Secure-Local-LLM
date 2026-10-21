import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/react/i18n";
import { readDraftText, writeDraftText } from "./draftText";

/** The original Drawer lives under body, outside the transformed empty-chat panel. */
export function ExpandedInputDrawer({
  draft,
  onChange,
  onClose,
}: {
  draft: string;
  onChange: (draft: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const modal = useRef<HTMLDivElement>(null);
  const editor = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const input = editor.current!;
    writeDraftText(input, draft);
    input.focus({ preventScroll: true });
    // Original InputModal initializes the rich editor with its caret at the draft end.
    const range = document.createRange();
    range.selectNodeContents(input.lastElementChild ?? input);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    // The mounted editor owns subsequent DOM edits; the parent receives every input.
  }, []);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const keydown = (event: KeyboardEvent) => {
      const modals = document.getElementsByClassName("modal");
      if (event.key === "Escape" && modals[modals.length - 1] === modal.current)
        close.current();
    };
    window.addEventListener("keydown", keydown);
    return () => {
      window.removeEventListener("keydown", keydown);
      document.body.style.overflow = previousOverflow;
    };
  }, []);
  return createPortal(
    <div
      ref={modal}
      className="modal chat-input-modal-backdrop fixed right-0 bottom-0 left-0 z-999 flex h-screen max-h-[100dvh] w-full justify-center overflow-hidden overscroll-contain bg-black/60"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("Input")}
        className="chat-input-modal mt-auto w-full bg-gray-50 dark:bg-gray-900 dark:text-gray-100 scrollbar-hidden max-h-[100dvh] overflow-y-auto"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex h-full min-h-screen flex-col">
          <div className="sticky top-0 z-30 flex justify-between bg-white px-4.5 pt-3 pb-3 dark:bg-gray-900 dark:text-gray-100">
            <div className="self-center text-lg">{t("Input")}</div>
            <button
              type="button"
              className="self-center"
              aria-label={t("Close")}
              onClick={onClose}
            >
              <svg
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-5 w-5"
                aria-hidden="true"
              >
                <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
              </svg>
            </button>
          </div>
          <div className="flex w-full px-4 dark:text-gray-200 min-h-full flex-1">
            <div className="flex-1 w-full min-h-full">
              <div className="relative w-full min-w-full input-prose min-h-fit h-full">
                <div
                  id="input-modal"
                  ref={editor}
                  role="textbox"
                  aria-multiline="true"
                  aria-label={t("Type here...")}
                  className="chat-expanded-editor ProseMirror"
                  contentEditable
                  suppressContentEditableWarning
                  onInput={(event) => {
                    onChange(readDraftText(event.currentTarget));
                  }}
                  onPaste={(event) => {
                    event.preventDefault();
                    document.execCommand(
                      "insertText",
                      false,
                      event.clipboardData.getData("text/plain"),
                    );
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
