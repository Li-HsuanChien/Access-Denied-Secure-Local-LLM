import { NativeDropdown } from "../../desktop-shell/react/NativeDropdown";
import { useI18n } from "@/react/i18n";
// Assistant chrome translated from pinned Open WebUI ResponseMessage; see frontend LICENSE.
import { useEffect, useRef, useState } from "react";
import type { AssistantMessageViewProps } from "../../react-contracts/rendering";
import { ChatAnswer } from "./ChatAnswer";
import { Icon } from "./Icon";
import { Modal } from "./Modal";
import { useTooltips } from "./useTooltips";
import "./renderer.css";
const action =
  "p-1.5 hover:bg-black/5 dark:hover:bg-white/5 rounded-lg dark:hover:text-white hover:text-black transition";
export function AssistantMessageView({
  message,
  branch,
  onNavigate,
  onCopy,
  onSelectBranch,
  onSaveEdit,
  onRegenerate,
  onDelete,
  canRegenerate,
  canDelete,
}: AssistantMessageViewProps) {
  const { t } = useI18n();
  const tooltipRoot = useTooltips<HTMLDivElement>("bottom");
  const [editing, setEditing] = useState(false),
    [edited, setEdited] = useState(message.content),
    [menu, setMenu] = useState(false),
    [suggestion, setSuggestion] = useState(""),
    [confirm, setConfirm] = useState(false),
    [branchEdit, setBranchEdit] = useState(false),
    [branchValue, setBranchValue] = useState(String(branch.index)),
    [copied, setCopied] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null),
    menuTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setEditing(false);
    setEdited(message.content);
    setMenu(false);
    setBranchEdit(false);
    setBranchValue(String(branch.index));
  }, [message.id]);
  useEffect(() => {
    if (editing && textarea.current) {
      textarea.current.style.height = "";
      textarea.current.style.height = `${textarea.current.scrollHeight}px`;
      textarea.current.focus();
      textarea.current.setSelectionRange(edited.length, edited.length);
    }
  }, [editing]);
  const save = (asCopy: boolean) => {
    onSaveEdit(edited, asCopy);
    setEditing(false);
  };
  const regenerate = (value?: string) => {
    setMenu(false);
    onRegenerate(value);
  };
  const select = () => {
    const number = Number(branchValue);
    if (Number.isInteger(number) && number >= 1 && number <= branch.count)
      onSelectBranch(number);
    setBranchEdit(false);
  };
  const timestamp = new Date(message.createdAt);
  return (
    <div
      ref={tooltipRoot}
      className={`renderer-assistant flex w-full message-${message.id}`}
      id={`message-${message.id}`}
      style={{ scrollMarginTop: "3rem" }}
    >
      <div className="shrink-0 mr-2 hidden @lg:flex mt-0.5">
        <img
          aria-hidden="true"
          src="/static/favicon.png"
          className="size-7 assistant-message-profile-image object-cover rounded-2xl"
          alt="profile"
          draggable="false"
        />
      </div>
      <div className="flex-auto w-0 pl-1 relative">
        <div className="self-center text-[0.9375rem] font-normal line-clamp-1 flex gap-1 items-center">
          <span
            id="response-message-model-name"
            className="line-clamp-1 text-black dark:text-white"
            title="Document Assistant"
          >
            Document Assistant
          </span>
        </div>
        <div className="chat-assistant w-full min-w-full">
          {editing && (
            <div className="w-full bg-gray-50 dark:bg-gray-800 rounded-3xl px-3 py-3 my-2">
              <textarea
                ref={textarea}
                id={`message-edit-${message.id}`}
                aria-label="Edit message"
                className="bg-transparent outline-hidden focus-visible:outline-none! w-full resize-none text-[0.9375rem]"
                value={edited}
                onChange={(event) => {
                  setEdited(event.target.value);
                  event.target.style.height = "";
                  event.target.style.height = `${event.target.scrollHeight}px`;
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setEditing(false);
                  if (
                    (event.ctrlKey || event.metaKey) &&
                    event.key === "Enter"
                  ) {
                    event.preventDefault();
                    save(false);
                  }
                }}
              />
              <div className="mt-2 flex justify-between text-sm font-normal">
                <button
                  type="button"
                  id="save-new-message-button"
                  className="px-2.5 py-1 bg-gray-50 hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700 border border-gray-100 dark:border-gray-700 text-gray-700 dark:text-gray-200 transition rounded-3xl"
                  onClick={() => save(true)}
                >
                  {t("Save As Copy")}
                </button>
                <div className="flex space-x-1.5">
                  <button
                    type="button"
                    id="close-edit-message-button"
                    className="px-2.5 py-1 bg-white dark:bg-gray-900 hover:bg-gray-100 text-gray-800 dark:text-gray-100 transition rounded-3xl"
                    onClick={() => setEditing(false)}
                  >
                    {t("Cancel")}
                  </button>
                  <button
                    type="button"
                    id="confirm-edit-message-button"
                    className="px-2.5 py-1 bg-gray-900 dark:bg-white hover:bg-gray-850 text-gray-100 dark:text-gray-800 transition rounded-3xl"
                    onClick={() => save(false)}
                  >
                    {t("Save")}
                  </button>
                </div>
              </div>
            </div>
          )}
          <div
            className={`w-full flex flex-col relative ${editing ? "hidden" : ""}`}
            id="response-content-container"
          >
            {message.content && (
              <ChatAnswer
                key={message.id}
                messageId={message.id}
                content={message.content}
                citations={message.answer?.citations ?? []}
                collectionVersion={message.answer?.collection_version}
                onNavigate={onNavigate}
                onSaveContent={(content) => onSaveEdit(content, false)}
              />
            )}
            {message.status === "pending" && (
              <div
                className="text-[0.9375rem] leading-relaxed"
                aria-label="Answer in progress"
              >
                <span className="inline-block w-[0.125rem] h-3.5 bg-gray-400 dark:bg-gray-500 ml-0.5 animate-pulse align-text-bottom" />
              </div>
            )}
            {message.status === "error" && (
              <div
                role="alert"
                className="my-1.5 flex w-full items-start gap-2 rounded-2xl bg-black/[0.03] px-3 py-2 text-gray-500 dark:bg-white/[0.04] dark:text-gray-400"
              >
                <Icon
                  name="info"
                  className="mt-0.5 size-4 shrink-0 text-gray-400 dark:text-gray-500"
                  strokeWidth={1.8}
                />
                <div className="min-w-0 break-words text-[0.8125rem] leading-5">
                  {message.error ?? message.content}
                </div>
              </div>
            )}
          </div>
        </div>
        {!editing && message.status !== "pending" && (
          <div className="renderer-assistant-actions flex items-center justify-start whitespace-nowrap buttons text-gray-600 dark:text-gray-500 mt-0.5 [&>*]:shrink-0">
            {branch.count > 1 && (
              <div className="flex self-center min-w-fit" dir="ltr">
                <button
                  type="button"
                  aria-label={t("Previous message")}
                  className="self-center p-1 hover:bg-black/5 dark:hover:bg-white/5 dark:hover:text-white hover:text-black rounded-md transition"
                  onClick={() => onSelectBranch(Math.max(1, branch.index - 1))}
                >
                  <Icon
                    name="previous"
                    className="size-3.5"
                    strokeWidth={2.5}
                  />
                </button>
                {branchEdit ? (
                  <div className="text-sm flex justify-center font-normal self-center dark:text-gray-100 min-w-fit">
                    <input
                      aria-label="Message branch"
                      type="number"
                      min={1}
                      max={branch.count}
                      value={branchValue}
                      autoFocus
                      onFocus={(event) => event.target.select()}
                      onChange={(event) => setBranchValue(event.target.value)}
                      onBlur={select}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          select();
                        }
                        if (event.key === "Escape") setBranchEdit(false);
                      }}
                      className="renderer-branch-input bg-transparent font-normal self-center dark:text-gray-100 min-w-fit outline-hidden"
                    />
                    /{branch.count}
                  </div>
                ) : (
                  <div
                    className="text-sm tracking-widest font-normal self-center dark:text-gray-100 min-w-fit"
                    onDoubleClick={() => {
                      setBranchValue(String(branch.index));
                      setBranchEdit(true);
                    }}
                  >
                    {branch.index}/{branch.count}
                  </div>
                )}
                <button
                  type="button"
                  aria-label={t("Next message")}
                  className="self-center p-1 hover:bg-black/5 dark:hover:bg-white/5 dark:hover:text-white hover:text-black rounded-md transition"
                  onClick={() =>
                    onSelectBranch(Math.min(branch.count, branch.index + 1))
                  }
                >
                  <Icon name="next" className="size-3.5" strokeWidth={2.5} />
                </button>
              </div>
            )}
            <button
              type="button"
              aria-label={t("Edit")}
              title={t("Edit")}
              className={action}
              onClick={() => {
                setEdited(message.content);
                setEditing(true);
              }}
            >
              <Icon name="edit" />
            </button>
            <button
              type="button"
              aria-label={t("Copy")}
              title={copied ? t("Copied") : t("Copy")}
              className={`${action} copy-response-button`}
              onClick={() => {
                void onCopy().then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1000);
                });
              }}
            >
              <Icon name={copied ? "check" : "copy"} />
            </button>
            {canRegenerate && (
              <div className="relative">
                <button
                  type="button"
                  ref={menuTrigger}
                  aria-label={t("Regenerate")}
                  title={t("Regenerate")}
                  aria-expanded={menu}
                  className={action}
                  onClick={() => setMenu(!menu)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setMenu(!menu);
                    }
                  }}
                >
                  <Icon name="reset" />
                </button>
                <NativeDropdown
                  open={menu}
                  onOpenChange={setMenu}
                  triggerRef={menuTrigger}
                  sideOffset={-2}
                  className="renderer-regenerate-menu"
                >
                  <div>
                    <div className="app-dropdown-menu rounded-xl! p-0.5! border border-gray-100 dark:border-gray-800 z-50 bg-white dark:bg-gray-850 dark:text-white shadow-lg max-w-[12.5rem] transition [&>button]:flex [&>button]:w-full [&>button]:h-[1.6875rem] [&>button]:items-center [&>button]:gap-2 [&>button]:rounded-xl! [&>button]:px-2! [&>button]:text-[0.8125rem] [&>button:hover]:bg-gray-50/60 dark:[&>button:hover]:bg-gray-800/60 [&>a]:flex [&>a]:w-full [&>a]:h-[1.6875rem] [&>a]:items-center [&>a]:gap-2 [&>a]:rounded-xl! [&>a]:px-2! [&>a]:text-[0.8125rem] [&>a:hover]:bg-gray-50/60 dark:[&>a:hover]:bg-gray-800/60 [&>button_svg]:size-3.5 [&>a_svg]:size-3.5 [&>hr]:my-0.5 [&>hr]:mx-1">
                      <div className="py-1 px-2 flex dark:text-gray-100">
                        <input
                          type="text"
                          id="floating-message-input"
                          className="bg-transparent outline-hidden w-full flex-1 text-[0.8125rem]"
                          placeholder={t("Suggest a change")}
                          value={suggestion}
                          autoComplete="off"
                          onChange={(event) =>
                            setSuggestion(event.target.value)
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter") regenerate(suggestion);
                          }}
                        />
                        <div className="ml-2 self-center flex items-center">
                          <button
                            type="button"
                            aria-label={t("Submit suggestion")}
                            className={`${suggestion ? "bg-black text-white hover:bg-gray-900 dark:bg-white dark:text-black dark:hover:bg-gray-100" : "text-white bg-gray-200 dark:text-gray-900 dark:bg-gray-700 disabled"} transition rounded-full p-1 self-center`}
                            onClick={() => regenerate(suggestion)}
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              viewBox="0 0 16 16"
                              fill="currentColor"
                              className="size-3.5"
                            >
                              <path
                                fillRule="evenodd"
                                d="M8 14a.75.75 0 0 1-.75-.75V4.56L4.03 7.78a.75.75 0 0 1-1.06-1.06l4.5-4.5a.75.75 0 0 1 1.06 0l4.5 4.5a.75.75 0 0 1-1.06 1.06L8.75 4.56v8.69A.75.75 0 0 1 8 14Z"
                                clipRule="evenodd"
                              />
                            </svg>
                          </button>
                        </div>
                      </div>
                      <hr className="border-gray-50/30 dark:border-gray-800/30 my-0.5 mx-1" />
                      {(
                        [
                          ["Try Again", "reset"],
                          ["Add Details", "detailsMore"],
                          ["More Concise", "detailsLess"],
                        ] as const
                      ).map(([label, icon]) => (
                        <button
                          key={label}
                          type="button"
                          className="select-none flex h-[1.6875rem] w-full items-center gap-2 rounded-xl px-2 text-[0.8125rem] cursor-pointer hover:bg-gray-50/40 dark:hover:bg-gray-800/40"
                          onClick={() =>
                            regenerate(
                              label === "Try Again" ? undefined : t(label),
                            )
                          }
                        >
                          <Icon
                            name={icon}
                            className="size-3.5"
                            strokeWidth={2}
                          />
                          <div className="flex items-center">{t(label)}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </NativeDropdown>
              </div>
            )}
            {canDelete && (
              <button
                type="button"
                aria-label={t("Delete")}
                title={t("Delete")}
                id="delete-response-button"
                className={action}
                onClick={() => setConfirm(true)}
              >
                <Icon name="delete" />
              </button>
            )}
            <time
              dateTime={timestamp.toISOString()}
              title={timestamp.toLocaleString()}
              className="hover-reveal ml-1 shrink-0 whitespace-nowrap text-[0.6875rem] tabular-nums text-gray-400 dark:text-gray-600 select-none"
            >
              {timestamp.toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </time>
          </div>
        )}
      </div>
      {confirm && (
        <Modal
          label={t("Delete message?")}
          onClose={() => setConfirm(false)}
          confirm
        >
          <div className="px-5 py-5 flex flex-col">
            <div className="text-base font-medium dark:text-gray-200 mb-2.5">
              {t("Delete message?")}
            </div>
            <div className="text-sm text-gray-500 flex-1">
              {t("This action cannot be undone. Do you wish to continue?")}
            </div>
            <div className="mt-5 flex justify-between gap-1.5">
              <button
                type="button"
                className="text-sm bg-gray-100 hover:bg-gray-100/70 text-gray-800 dark:bg-gray-850 dark:text-white font-normal w-full py-1.5 rounded-full transition"
                onClick={() => setConfirm(false)}
              >
                {t("Cancel")}
              </button>
              <button
                type="button"
                className="text-sm bg-gray-900 text-gray-100 dark:bg-gray-100 dark:text-gray-800 font-normal w-full py-1.5 rounded-full transition"
                onClick={() => {
                  setConfirm(false);
                  onDelete();
                }}
              >
                {t("Confirm")}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
