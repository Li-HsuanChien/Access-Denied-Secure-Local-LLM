import { useI18n } from "@/react/i18n";
import { ExpandedInputDrawer } from "./ExpandedInputDrawer";
import {
  readDraftText,
  writeDraftText,
  serializeDraftForSubmit,
} from "./draftText";
import { ModelMenu } from "./chatMotion";
import { ModelOption } from "./ModelOption";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChatController, ChatSession } from "../../react-contracts";
import { workspaceVoice } from "../../personality/presentation";
import { visibleMessages } from "./chatController";
import { Icon } from "./icons";
import { Tooltip } from "./Tooltip";
import { copyToClipboard } from "./clipboard";
export function Composer({
  session,
  controller,
  pending,
}: {
  session: ChatSession;
  controller: ChatController;
  pending: boolean;
}) {
  const { t } = useI18n();
  const input = useRef<HTMLDivElement>(null),
    modelTrigger = useRef<HTMLButtonElement>(null),
    composing = useRef(false);
  const [status, setStatus] = useState(false),
    [models, setModels] = useState(false),
    [search, setSearch] = useState(""),
    [expanded, setExpanded] = useState(false),
    [slashDismissed, setSlashDismissed] = useState(false),
    [copiedId, setCopiedId] = useState(false),
    [compare, setCompare] = useState(false);
  const empty = !session.currentId;
  const focus = () => input.current?.focus({ preventScroll: true });
  useLayoutEffect(() => {
    if (input.current && readDraftText(input.current) !== session.draft) {
      if (session.draft) writeDraftText(input.current, session.draft);
      else input.current.replaceChildren();
    }
  }, [session.draft]);
  useLayoutEffect(() => {
    if (!expanded) focus();
  }, [expanded]);
  const submit = () => {
    // The controller clears its live draft synchronously, before React commits updated DOM.
    const draft = controller.session.draft;
    const command = draft.trim();
    if (command === "/status") {
      controller.setDraft("");
      setStatus(true);
    } else if (/^\/model(?:\s|$)/.test(command)) {
      controller.setDraft("");
      setModels(command === "/model");
    } else if (command === "/compact" || command === "/fork") {
      controller.setDraft(`${command} `);
      setSlashDismissed(true);
    } else controller.submit(serializeDraftForSubmit(draft));
    focus();
  };
  const slashCommands = ["status", "model", "compact", "fork"].filter(
    (s) =>
      session.draft.startsWith("/") &&
      s.startsWith(session.draft.slice(1).trim()) &&
      !slashDismissed,
  );
  // Native MessageInput computes this when its active-chat instance mounts; later local answers do not refresh it.
  const [tokens] = useState(() =>
    visibleMessages(session).reduce(
      (n, m) =>
        n + 4 + (m.content ? Math.max(1, Math.floor(m.content.length / 4)) : 0),
      0,
    ),
  );
  const tokenLabel =
    tokens >= 1_000_000
      ? `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`
      : tokens >= 1_000
        ? `${tokens >= 10_000 ? Math.round(tokens / 1_000) : (tokens / 1_000).toFixed(1).replace(/\.0$/, "")}k`
        : String(tokens);
  return (
    <div className="chat-composer w-full">
      {session.queue.length > 0 && (
        <div className="chat-queue mb-1 mx-2 py-0.5 px-1.5 rounded-2xl bg-white dark:bg-gray-900/60 border border-gray-100 dark:border-gray-800/50 max-h-[25vh] overflow-auto">
          {session.queue.map((item) => (
            <div key={item.id} className="flex items-center gap-2 px-2 py-1.5">
              <Icon name="queue" className="size-3.5 shrink-0 text-gray-500" />
              <p className="flex-1 min-w-0 text-sm text-gray-600 dark:text-gray-300 truncate">
                {item.question}
              </p>
              <div className="flex gap-1 shrink-0">
                <Tooltip content={t("Edit")}>
                  <button
                    type="button"
                    aria-label={t("Edit")}
                    className="p-1 text-gray-400 dark:text-gray-500"
                    onClick={() => {
                      controller.editQueued(item.id);
                      focus();
                    }}
                  >
                    <Icon name="edit" className="size-3.5" />
                  </button>
                </Tooltip>
                <Tooltip content={t("Delete")}>
                  <button
                    type="button"
                    aria-label={t("Delete")}
                    className="p-1 text-gray-400 dark:text-gray-500"
                    onClick={() => controller.deleteQueued(item.id)}
                  >
                    <Icon name="delete" className="size-3.5" />
                  </button>
                </Tooltip>
              </div>
            </div>
          ))}
        </div>
      )}
      {status && (
        <div className="mx-1 rounded-2xl bg-white text-xs dark:bg-gray-900 text-gray-600 dark:text-gray-400">
          <div className="flex items-center justify-between px-3 py-1.5">
            <span>{t("Status")}</span>
            <button
              type="button"
              className="text-gray-400"
              onClick={() => setStatus(false)}
            >
              {t("Close")}
            </button>
          </div>
          <div className="px-3 pb-2 space-y-0.5">
            <div className="flex min-h-4 gap-3 py-0.5">
              <span className="flex-1">{t("Context usage")}</span>
              <span className="font-mono text-[0.625rem] text-gray-400">
                {empty ? t("unknown") : `${tokenLabel} ${t("tokens")}`}
              </span>
            </div>
            {session.queue.length > 0 && (
              <div className="flex min-h-5 gap-3">
                <span className="flex-1">{t("Queued messages")}</span>
                <span>{session.queue.length}</span>
              </div>
            )}
            <div className="flex min-h-5 gap-3">
              <span className="flex-1">{t("Chat ID")}</span>
              {empty ? (
                <span className="font-mono text-[0.625rem]">none</span>
              ) : (
                <button
                  type="button"
                  className="max-w-[18rem] truncate font-mono text-[0.625rem]"
                  onClick={async () => {
                    await copyToClipboard("temporary:undefined");
                    setCopiedId(true);
                    setTimeout(() => setCopiedId(false), 1600);
                  }}
                >
                  {copiedId ? t("Copied") : "temporary:undefined"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div
          id="message-input-container"
          className="flex-1 flex flex-col relative w-full shadow-lg rounded-3xl border border-dashed border-gray-100 dark:border-gray-800 hover:border-gray-200 focus-within:border-gray-200 hover:dark:border-gray-700 focus-within:dark:border-gray-700 transition px-0.5 bg-white/5 dark:bg-gray-500/5 backdrop-blur-sm dark:text-gray-100"
          dir="auto"
        >
          {slashCommands.length > 0 && (
            <div
              className="chat-slash-menu"
              role="listbox"
              aria-label="Commands"
            >
              {slashCommands.map((command) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  key={command}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    controller.setDraft(`/${command}`);
                    if (command === "status") setStatus(true);
                    if (command === "model") setModels(true);
                    if (command === "status" || command === "model")
                      controller.setDraft("");
                    else {
                      controller.setDraft(`/${command} `);
                      setSlashDismissed(true);
                    }
                    focus();
                  }}
                >
                  /{command}
                </button>
              ))}
            </div>
          )}
          <div className="px-2 relative">
            {session.draft.split("\n").length > 2 && (
              <button
                type="button"
                aria-label={t("Expand input")}
                className="absolute top-2.5 right-3 z-20 p-1 rounded-lg"
                onClick={() => setExpanded(true)}
              >
                <Icon name="expand" className="size-4" />
              </button>
            )}
            <div
              id="chat-input-container"
              className="scrollbar-hidden text-left bg-transparent dark:text-gray-100 w-full pb-0.5 px-1 h-fit max-h-96 overflow-auto pt-2"
            >
              <div
                id="chat-input"
                className="chat-editable"
                contentEditable={!expanded}
                suppressContentEditableWarning
                data-placeholder={workspaceVoice.askPlaceholder}
                aria-label={workspaceVoice.askPlaceholder}
                ref={input}
                onInput={(e) => {
                  const draft = readDraftText(e.currentTarget);
                  controller.setDraft(draft);
                  if (!draft && !composing.current)
                    e.currentTarget.replaceChildren();
                  setSlashDismissed(false);
                }}
                onCompositionStart={() => {
                  composing.current = true;
                }}
                onCompositionEnd={() => {
                  composing.current = false;
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setModels(false);
                    setSlashDismissed(true);
                    return;
                  }
                  if (
                    e.key === "Enter" &&
                    e.shiftKey &&
                    !e.nativeEvent.isComposing &&
                    !composing.current &&
                    typeof document.execCommand === "function"
                  ) {
                    e.preventDefault();
                    document.execCommand("insertParagraph");
                    return;
                  }
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing &&
                    !composing.current &&
                    e.keyCode !== 229
                  ) {
                    e.preventDefault();
                    submit();
                  }
                }}
                onPaste={(e) => {
                  e.preventDefault();
                  const text = e.clipboardData.getData("text/plain");
                  document.execCommand("insertText", false, text);
                }}
              />
            </div>
          </div>
          <div className="chat-composer-tools flex justify-end mx-0.5 mb-2 mt-0.5 max-w-full">
            <div className="self-end flex space-x-1 mr-1 min-w-0 gap-[0.03125rem]">
              <div className="relative flex min-w-0 max-w-[10rem] items-center sm:max-w-[13rem]">
                <button
                  ref={modelTrigger}
                  id="model-selector-model-button"
                  type="button"
                  aria-label={t("Selected model: {{modelName}}", {
                    modelName: "Document Assistant",
                  })}
                  aria-haspopup="listbox"
                  aria-expanded={models}
                  className="focus-ring relative w-full outline-hidden focus:outline-hidden"
                  onClick={() => {
                    if (!models) setSearch("");
                    setModels((v) => !v);
                  }}
                >
                  <div className="flex w-full min-w-0 text-left px-0.5 bg-transparent items-center gap-1.5 rounded-lg pl-2 pr-1.5 py-1 text-[0.8125rem] font-normal text-gray-600 transition-colors duration-100 hover:bg-gray-50/40 hover:text-gray-700 dark:text-gray-300 dark:hover:bg-gray-800/40 dark:hover:text-gray-200 justify-between placeholder-gray-400">
                    <span className="min-w-0 flex-1 truncate">
                      Document Assistant
                    </span>
                    <Icon
                      name="down"
                      className="ml-1 size-2.5 shrink-0 self-center"
                      strokeWidth="2.5"
                    />
                  </div>
                </button>
                <ModelMenu
                  open={models}
                  triggerRef={modelTrigger}
                  onClose={(restoreComposer = true) => {
                    setModels(false);
                    if (restoreComposer) focus();
                    else modelTrigger.current?.blur();
                  }}
                >
                  <div className="chat-model-search">
                    <svg
                      className="size-3.5 shrink-0"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
                      />
                    </svg>
                    <input
                      id="model-search-input"
                      placeholder={t("Search a model")}
                      aria-label={t("Search In Models")}
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          setModels(false);
                          focus();
                        }
                        if (
                          e.key === "Enter" &&
                          "Document Assistant"
                            .toLowerCase()
                            .includes(search.toLowerCase())
                        ) {
                          setModels(false);
                          focus();
                        }
                      }}
                    />
                    <Tooltip content={t("Compare")}>
                      <button
                        type="button"
                        aria-label={t("Compare")}
                        aria-pressed={compare}
                        className={`chat-model-compare ${compare ? "bg-gray-50 dark:bg-gray-800/60" : ""}`}
                        onClick={() => setCompare((v) => !v)}
                      >
                        <svg
                          className="size-3"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M13.8476 13.317L9.50515 18.2798C8.70833 19.1905 7.29167 19.1905 6.49485 18.2798L2.15238 13.317C1.49259 12.563 1.49259 11.437 2.15238 10.683L6.49485 5.72018C7.29167 4.80952 8.70833 4.80952 9.50515 5.72017L13.8476 10.683C14.5074 11.437 14.5074 12.563 13.8476 13.317Z M13 19L17.8844 13.3016C18.5263 12.5526 18.5263 11.4474 17.8844 10.6984L13 5 M17 19L21.8844 13.3016C22.5263 12.5526 22.5263 11.4474 21.8844 10.6984L17 5" />
                        </svg>
                      </button>
                    </Tooltip>
                  </div>
                  <div role="listbox" aria-label={t("Available models")}>
                    {"Document Assistant"
                      .toLowerCase()
                      .includes(search.toLowerCase()) ? (
                      <ModelOption
                        onSelect={() => {
                          setModels(false);
                          focus();
                        }}
                      />
                    ) : (
                      <p className="px-2 min-h-8 flex items-center">
                        {t("No results found")}
                      </p>
                    )}
                  </div>
                  {empty ? (
                    <button
                      type="button"
                      className="chat-model-default"
                      onClick={() => {
                        /* The original unsupported default-model request leaves this menu open. */
                      }}
                    >
                      {t("Set as default")}
                    </button>
                  ) : (
                    <div className="shrink-0 pb-1" />
                  )}
                </ModelMenu>
              </div>
              {pending ? (
                <span className="chat-pending-send-space" aria-hidden="true" />
              ) : (
                <Tooltip content={t("Send message")}>
                  <button
                    id="send-message-button"
                    type="submit"
                    disabled={!session.draft.trim()}
                    className={`${session.draft.trim() ? "bg-black text-white hover:bg-gray-900 dark:bg-white dark:text-black dark:hover:bg-gray-100" : "text-white bg-gray-200 dark:text-gray-900 dark:bg-gray-700 disabled"} transition rounded-full p-[0.3125rem] self-center`}
                  >
                    <svg
                      viewBox="0 0 16 16"
                      fill="currentColor"
                      className="size-5"
                      aria-hidden="true"
                    >
                      <path
                        fillRule="evenodd"
                        clipRule="evenodd"
                        d="M8 14a.75.75 0 0 1-.75-.75V4.56L4.03 7.78a.75.75 0 0 1-1.06-1.06l4.5-4.5a.75.75 0 0 1 1.06 0l4.5 4.5a.75.75 0 0 1-1.06 1.06L8.75 4.56v8.69A.75.75 0 0 1 8 14Z"
                      />
                    </svg>
                  </button>
                </Tooltip>
              )}
            </div>
          </div>
        </div>
        <div className="mb-0.5" />
      </form>
      {expanded && (
        <ExpandedInputDrawer
          draft={session.draft}
          onChange={controller.setDraft}
          onClose={() => {
            setExpanded(false);
            focus();
          }}
        />
      )}
    </div>
  );
}
