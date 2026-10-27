import { useRef, useState } from "react";
import { useI18n } from "@/react/i18n";
import { NativeDropdown } from "@/lib/features/desktop-shell/react/NativeDropdown";
import { usePinnedModel } from "@/lib/features/desktop-shell/react/PinnedModel";
import { Icon } from "./icons";
import { Tooltip } from "./Tooltip";
import { copyToClipboard } from "./clipboard";

export function ModelOption({ onSelect }: { onSelect: () => void }) {
  const { t } = useI18n(),
    { pinned, setPinned } = usePinnedModel();
  const [more, setMore] = useState(false),
    [focusMore, setFocusMore] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <div
      role="option"
      tabIndex={0}
      aria-selected="true"
      data-arrow-selected="true"
      data-value="secure-qa-local"
      aria-label={t("Select {{modelName}} model", {
        modelName: "Document Assistant",
      })}
      className="chat-model-option"
      onClick={onSelect}
      onKeyDown={(event) => {
        if (
          event.target === event.currentTarget &&
          (event.key === "Enter" || event.key === " ")
        ) {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <div className="flex flex-1 flex-col gap-1.5 overflow-hidden">
        <div className="flex items-center gap-2 overflow-hidden">
          <div className="flex items-center min-w-fit">
            <img
              src="/favicon.png"
              className="flex size-4 rounded-full"
              alt={t("{{modelName}} profile image", {
                modelName: "Document Assistant",
              })}
            />
          </div>
          <div className="flex min-w-0 items-center">
            <Tooltip
              content="Document Assistant (secure-qa-local)"
              placement="top-start"
            >
              <div className="line-clamp-1">Document Assistant</div>
            </Tooltip>
          </div>
        </div>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1.5 pl-2">
        <Tooltip content={t("More")} className="chat-model-more flex">
          <button
            type="button"
            ref={trigger}
            aria-label={t("More Options")}
            className="focus-ring flex"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setFocusMore(false);
              setMore((value) => !value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setFocusMore(true);
                setMore((value) => !value);
              }
            }}
          >
            <Icon name="dots" className="size-4" strokeWidth="1.5" />
          </button>
        </Tooltip>
        <NativeDropdown
          open={more}
          onOpenChange={setMore}
          triggerRef={trigger}
          align="end"
          sideOffset={-2}
          className="model-selector-child-menu"
          focusOnOpen={focusMore}
        >
          <div className="chat-actions-menu chat-model-options">
            <button
              type="button"
              aria-pressed={pinned}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setPinned(!pinned);
                setMore(false);
              }}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="size-3.5"
                aria-hidden="true"
              >
                <path
                  d="M9.5 14.5L3 21"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d={
                    pinned
                      ? "M7.67602 7.8896L6.69713 7.78823L5.00007 9.48528L14.1925 18.6777L15.8895 16.9806L15.7879 16M11.4847 7L15.1568 2.67141L21.0065 8.5211L16.6991 12.175"
                      : "M5.00007 9.48528L14.1925 18.6777L15.8895 16.9806L15.4974 13.1944L21.0065 8.5211L15.1568 2.67141L10.4834 8.18034L6.69713 7.78823L5.00007 9.48528Z"
                  }
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {pinned && (
                  <path
                    d="M3 3L21 21"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
              </svg>
              <div className="flex items-center">
                {t(pinned ? "Hide from Sidebar" : "Keep in Sidebar")}
              </div>
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void copyToClipboard(
                  `${window.location.origin}/?model=secure-qa-local`,
                );
                setMore(false);
              }}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="size-3.5"
                aria-hidden="true"
              >
                <path
                  d="M14 11.9976C14 9.5059 11.683 7 8.85714 7C8.52241 7 7.41904 7.00001 7.14286 7.00001C4.30254 7.00001 2 9.23752 2 11.9976C2 14.376 3.70973 16.3664 6 16.8714C6.36756 16.9525 6.75006 16.9952 7.14286 16.9952"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M10 11.9976C10 14.4893 12.317 16.9952 15.1429 16.9952C15.4776 16.9952 16.581 16.9952 16.8571 16.9952C19.6975 16.9952 22 14.7577 22 11.9976C22 9.6192 20.2903 7.62884 18 7.12383C17.6324 7.04278 17.2499 6.99999 16.8571 6.99999"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <div className="flex items-center">{t("Copy Link")}</div>
            </button>
          </div>
        </NativeDropdown>
        <div>
          <svg
            className="size-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m4.5 12.75 6 6 9-13.5"
            />
          </svg>
        </div>
      </div>
    </div>
  );
}
