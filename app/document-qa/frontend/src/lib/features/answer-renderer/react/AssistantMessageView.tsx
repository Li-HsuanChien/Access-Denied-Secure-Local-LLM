import { NativeDropdown } from "../../desktop-shell/react/NativeDropdown";
import { useI18n } from "@/react/i18n";
import { useEffect, useId, useRef, useState, type ReactElement } from "react";
import type { AssistantMessageViewProps } from "../../react-contracts/rendering";
import {
  answerBasis,
  answerNotices,
  type AnswerBasis,
} from "../../answering/react/chatController";
import { answerBasisLabel, workspaceVoice } from "../../personality/presentation";
import {
  Button,
  ConfirmDialog,
  IconAlert,
  IconBook,
  IconButton,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconCompose,
  IconCopy,
  IconInfo,
  IconRefresh,
  IconSparkle,
  IconTrash,
  PendingDots,
  Popover,
} from "@/lib/features/design-system/react";
import { ChatAnswer } from "./ChatAnswer";
import { Icon } from "./Icon";
import "./renderer.css";

const basisIcon: Record<AnswerBasis, ReactElement> = {
  documents: <IconBook size={16} />,
  general: <IconSparkle size={16} />,
  none: <IconInfo size={16} />,
};

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
  const [editing, setEditing] = useState(false),
    [edited, setEdited] = useState(message.content),
    [menu, setMenu] = useState(false),
    [suggestion, setSuggestion] = useState(""),
    [confirm, setConfirm] = useState(false),
    [branchEdit, setBranchEdit] = useState(false),
    [branchValue, setBranchValue] = useState(String(branch.index)),
    [copied, setCopied] = useState(false),
    [detailsOpen, setDetailsOpen] = useState(false),
    [detailsAnchor, setDetailsAnchor] = useState<HTMLButtonElement | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null),
    menuTrigger = useRef<HTMLButtonElement>(null),
    deleteTrigger = useRef<HTMLButtonElement>(null);
  const detailsTitle = useId();
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
  const answer = message.answer;
  const basis =
    answer && message.status === "complete" && answer.status !== "failed"
      ? answerBasis(answer)
      : null;
  const notices = message.status === "complete" ? answerNotices(answer) : [];

  if (message.status === "pending")
    return (
      <div
        className={`qa-msg qa-msg-assistant renderer-assistant message-${message.id}`}
        id={`message-${message.id}`}
      >
        <div className="qa-pending" role="status">
          <PendingDots />
          <span className="qa-pending-text">{workspaceVoice.answerPending}</span>
        </div>
      </div>
    );

  return (
    <article
      className={`qa-msg qa-msg-assistant renderer-assistant message-${message.id}`}
      id={`message-${message.id}`}
      data-basis={basis ?? undefined}
      aria-label={basis ? answerBasisLabel(basis) : "Answer"}
      style={{ scrollMarginTop: "3rem" }}
    >
      {basis && (
        <p className="qa-basis">
          {basisIcon[basis]}
          <span>{answerBasisLabel(basis)}</span>
        </p>
      )}
      {message.status === "error" ? (
        <div role="alert" className="ui-callout ui-callout-error qa-failure">
          <IconAlert size={18} />
          <div>
            <p>
              <strong>No answer this time.</strong>{" "}
              {message.error ?? workspaceVoice.answerFailed}
              {answer?.error?.hint ? ` ${answer.error.hint}` : ""} Your question
              is still above.
            </p>
            {canRegenerate && (
              <Button
                size="sm"
                variant="secondary"
                icon={<IconRefresh size={15} />}
                onClick={() => onRegenerate()}
              >
                Try again
              </Button>
            )}
          </div>
        </div>
      ) : (
        <>
          {editing && (
            <div className="qa-edit">
              <textarea
                ref={textarea}
                id={`message-edit-${message.id}`}
                aria-label="Edit message"
                className="qa-edit-input"
                value={edited}
                onChange={(event) => {
                  setEdited(event.target.value);
                  event.target.style.height = "";
                  event.target.style.height = `${event.target.scrollHeight}px`;
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setEditing(false);
                  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                    event.preventDefault();
                    save(false);
                  }
                }}
              />
              <p className="qa-edit-note">
                Edits change only this view. Sources stay tied to the original answer.
              </p>
              <div className="qa-edit-actions">
                <Button size="sm" variant="ghost" id="save-new-message-button" onClick={() => save(true)}>
                  {t("Save As Copy")}
                </Button>
                <span className="qa-edit-spacer" />
                <Button size="sm" variant="ghost" id="close-edit-message-button" onClick={() => setEditing(false)}>
                  {t("Cancel")}
                </Button>
                <Button size="sm" variant="primary" id="confirm-edit-message-button" onClick={() => save(false)}>
                  {t("Save")}
                </Button>
              </div>
            </div>
          )}
          <div
            className={`qa-answer-body ${editing ? "hidden" : ""}`}
            id="response-content-container"
          >
            {message.content && (
              <ChatAnswer
                key={message.id}
                messageId={message.id}
                content={message.content}
                citations={answer?.citations ?? []}
                collectionVersion={answer?.collection_version}
                onNavigate={onNavigate}
                onSaveContent={(content) => onSaveEdit(content, false)}
              />
            )}
          </div>
          {notices.length > 0 && (
            <div className="ui-callout ui-callout-warn qa-notice">
              <IconAlert size={16} />
              {notices.length === 1 ? (
                <span>{notices[0]}</span>
              ) : (
                <ul>
                  {notices.map((n) => (
                    <li key={n}>
                      <span>{n}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {message.historyWarning && (
            <p className="ui-callout ui-callout-warn qa-notice" role="status">
              <IconAlert size={16} />
              <span>
                {message.historyWarning} It stays here until you leave this chat.
              </span>
              {canRegenerate && (
                <button type="button" className="ui-link-btn" onClick={() => onRegenerate()}>
                  Ask again
                </button>
              )}
            </p>
          )}
        </>
      )}
      {!editing && (
        <div className="qa-msg-foot renderer-assistant-actions">
          <div className="qa-msg-actions">
            {branch.count > 1 && (
              <div className="qa-branch" dir="ltr">
                <IconButton
                  size="sm"
                  tooltip={false}
                  label={t("Previous message")}
                  icon={<IconChevronLeft size={15} />}
                  onClick={() => onSelectBranch(Math.max(1, branch.index - 1))}
                />
                {branchEdit ? (
                  <span className="qa-branch-count">
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
                      className="renderer-branch-input"
                    />
                    /{branch.count}
                  </span>
                ) : (
                  <span
                    className="qa-branch-count"
                    onDoubleClick={() => {
                      setBranchValue(String(branch.index));
                      setBranchEdit(true);
                    }}
                  >
                    {branch.index}/{branch.count}
                  </span>
                )}
                <IconButton
                  size="sm"
                  tooltip={false}
                  label={t("Next message")}
                  icon={<IconChevronRight size={15} />}
                  onClick={() => onSelectBranch(Math.min(branch.count, branch.index + 1))}
                />
              </div>
            )}
            {message.status !== "error" && (
              <IconButton
                size="sm"
                side="top"
                className="copy-response-button"
                label={copied ? t("Copied") : t("Copy")}
                icon={copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                onClick={() => {
                  void onCopy().then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1600);
                  });
                }}
              />
            )}
            {message.status !== "error" && (
              <IconButton
                size="sm"
                side="top"
                label={t("Edit")}
                icon={<IconCompose size={16} />}
                onClick={() => {
                  setEdited(message.content);
                  setEditing(true);
                }}
              />
            )}
            {canRegenerate && (
              <span className="qa-regenerate">
                <IconButton
                  ref={menuTrigger}
                  size="sm"
                  side="top"
                  label={t("Regenerate")}
                  aria-expanded={menu}
                  icon={<IconRefresh size={16} />}
                  onClick={() => setMenu(!menu)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setMenu(!menu);
                    }
                  }}
                />
                <NativeDropdown
                  open={menu}
                  onOpenChange={setMenu}
                  triggerRef={menuTrigger}
                  sideOffset={-2}
                  className="renderer-regenerate-menu"
                >
                  <div className="qa-regen-menu">
                    <div className="qa-regen-suggest">
                      <input
                        type="text"
                        id="floating-message-input"
                        placeholder={t("Suggest a change")}
                        value={suggestion}
                        autoComplete="off"
                        onChange={(event) => setSuggestion(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") regenerate(suggestion);
                        }}
                      />
                      <button
                        type="button"
                        aria-label={t("Submit suggestion")}
                        className="qa-regen-submit"
                        data-ready={suggestion ? "" : undefined}
                        onClick={() => regenerate(suggestion)}
                      >
                        <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14" aria-hidden="true">
                          <path
                            fillRule="evenodd"
                            d="M8 14a.75.75 0 0 1-.75-.75V4.56L4.03 7.78a.75.75 0 0 1-1.06-1.06l4.5-4.5a.75.75 0 0 1 1.06 0l4.5 4.5a.75.75 0 0 1-1.06 1.06L8.75 4.56v8.69A.75.75 0 0 1 8 14Z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </button>
                    </div>
                    <hr />
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
                        className="qa-regen-item"
                        onClick={() => regenerate(label === "Try Again" ? undefined : t(label))}
                      >
                        <Icon name={icon} className="size-3.5" strokeWidth={2} />
                        <span>{t(label)}</span>
                      </button>
                    ))}
                  </div>
                </NativeDropdown>
              </span>
            )}
            {answer && (
              <IconButton
                ref={setDetailsAnchor}
                size="sm"
                side="top"
                label="Answer details"
                aria-haspopup="dialog"
                aria-expanded={detailsOpen}
                icon={<IconInfo size={16} />}
                onClick={() => setDetailsOpen((o) => !o)}
              />
            )}
            {canDelete && (
              <IconButton
                ref={deleteTrigger}
                size="sm"
                side="top"
                id="delete-response-button"
                label={t("Delete")}
                icon={<IconTrash size={16} />}
                onClick={() => setConfirm(true)}
              />
            )}
          </div>
        </div>
      )}
      {answer && (
        <Popover
          anchor={detailsAnchor}
          open={detailsOpen}
          onClose={() => setDetailsOpen(false)}
          labelledBy={detailsTitle}
          side="top"
          align="start"
          className="qa-details-popover"
        >
          <h2 id={detailsTitle} className="ui-popover-title">
            Answer details
          </h2>
          <dl className="ui-status-list">
            <div>
              <dt>Model</dt>
              <dd>
                {answer.model
                  ? `${answer.model.name}${answer.model.quant ? ` · ${answer.model.quant}` : ""}`
                  : "Not reported"}
              </dd>
            </div>
            <div>
              <dt>Time</dt>
              <dd>{(answer.timing.total_ms / 1000).toFixed(1)} seconds</dd>
            </div>
            <div>
              <dt>Passages used</dt>
              <dd>{answer.evidence.length || "None"}</dd>
            </div>
            <div>
              <dt>Library version</dt>
              <dd>{answer.collection_version ?? "None"}</dd>
            </div>
            <div>
              <dt>Answered</dt>
              <dd>
                <time dateTime={new Date(message.createdAt).toISOString()}>
                  {new Date(message.createdAt).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </time>
              </dd>
            </div>
            {message.historyWarning && (
              <div>
                <dt>Saved</dt>
                <dd>Not saved to history</dd>
              </div>
            )}
          </dl>
        </Popover>
      )}
      <ConfirmDialog
        open={confirm}
        title={t("Delete message?")}
        description={t("This action cannot be undone. Do you wish to continue?")}
        confirmLabel={t("Delete")}
        cancelLabel={t("Cancel")}
        returnFocus={deleteTrigger.current}
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          onDelete();
        }}
      />
    </article>
  );
}
