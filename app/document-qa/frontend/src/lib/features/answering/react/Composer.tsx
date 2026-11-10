import { useI18n } from "@/react/i18n";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { ChatController, ChatSession } from "../../react-contracts";
import { workspaceVoice } from "../../personality/presentation";
import {
  useHealth,
  useLibrary,
  useNavigation,
  usePreferences,
} from "../../../../react/providers";
import {
  Button,
  IconArrowUp,
  IconBook,
  IconButton,
  IconCompose,
  IconSparkle,
  IconTrash,
  Popover,
  Spinner,
  Tooltip,
} from "@/lib/features/design-system/react";
import {
  readDraftText,
  writeDraftText,
  serializeDraftForSubmit,
} from "./draftText";

/**
 * Reading-room composer. The editable stays a plain-text contenteditable (IME-safe, Enter sends,
 * Shift+Enter adds a line). One question runs at a time: Enter while an answer is pending queues
 * the question in this chat (discarded by New Chat); the send button explains why it is disabled.
 */
export function Composer({
  session,
  controller,
  pending,
  temporary = false,
  autoFocus = true,
}: {
  session: ChatSession;
  controller: ChatController;
  pending: boolean;
  temporary?: boolean;
  autoFocus?: boolean;
}) {
  const { t } = useI18n();
  const health = useHealth();
  const preferences = usePreferences();
  const library = useLibrary();
  const { navigate } = useNavigation();
  const input = useRef<HTMLDivElement>(null),
    composing = useRef(false);
  const hintId = useId(),
    docsTitle = useId();
  const [docsAnchor, setDocsAnchor] = useState<HTMLButtonElement | null>(null);
  const [docsOpen, setDocsOpen] = useState(false);
  const focus = () => input.current?.focus({ preventScroll: true });
  useLayoutEffect(() => {
    if (input.current && readDraftText(input.current) !== session.draft) {
      if (session.draft) writeDraftText(input.current, session.draft);
      else input.current.replaceChildren();
    }
  }, [session.draft]);
  useLayoutEffect(() => {
    if (autoFocus) focus();
  }, []);
  // The popover lists the active version's documents; read them (existing library.versions) on demand.
  useEffect(() => {
    if (docsOpen && !library.state.versions.length && !library.state.busy)
      void library.refresh().catch(() => undefined);
  }, [docsOpen]);

  const unavailable = health.readiness === "unavailable";
  const hasDraft = session.draft.trim().length > 0;
  const canSend = !unavailable && !pending && hasDraft;
  const sendLabel = unavailable
    ? "Answers are paused until the local model is ready"
    : pending
      ? "Wait for the current answer to finish"
      : hasDraft
        ? t("Send message")
        : "Type a question to send";

  const submit = () => {
    if (unavailable) return;
    // The controller clears its live draft synchronously, before React commits updated DOM.
    const draft = controller.session.draft;
    if (!draft.trim()) return;
    // While an answer is pending the controller queues the question (one question at a time).
    controller.submit(serializeDraftForSubmit(draft));
    focus();
  };

  const gk = preferences.state.generalKnowledge;
  const gkSaving = preferences.state.pending.generalKnowledge > 0;
  const gkError = preferences.state.errors.generalKnowledge;
  const toggleGeneral = () => {
    if (gkSaving) return;
    void preferences.setGeneralKnowledge(!gk).catch(() => undefined);
  };

  const active = library.state.versions.find((v) => v.status === "active");
  const enabledDocs = (active?.documents ?? []).filter((d) => d.enabled !== false);
  const offDocs = (active?.documents?.length ?? 0) - enabledDocs.length;
  const docCount = active ? enabledDocs.length : health.health?.library.document_count;
  const docLabel =
    docCount == null ? "Documents" : `${docCount} ${docCount === 1 ? "document" : "documents"}`;

  return (
    <div className="qa-composer-wrap chat-composer">
      {unavailable && (
        <p className="qa-composer-notice" role="status" data-state="unavailable">
          <span>
            Answers are paused: {health.message || workspaceVoice.serviceUnavailable}
          </span>
          <button
            type="button"
            className="ui-link-btn"
            disabled={health.refreshing}
            onClick={() => void health.refresh()}
          >
            {health.refreshing ? "Checking…" : "Check again"}
          </button>
        </p>
      )}
      {session.queue.length > 0 && (
        <ul className="qa-queue chat-queue" aria-label="Waiting to be asked">
          {session.queue.map((item) => (
            <li key={item.id}>
              <span className="qa-queue-label">Next</span>
              <p className="qa-queue-text">{item.question}</p>
              <IconButton
                size="sm"
                side="top"
                label={t("Edit")}
                icon={<IconCompose size={15} />}
                onClick={() => {
                  controller.editQueued(item.id);
                  focus();
                }}
              />
              <IconButton
                size="sm"
                side="top"
                label={t("Delete")}
                icon={<IconTrash size={15} />}
                onClick={() => controller.deleteQueued(item.id)}
              />
            </li>
          ))}
        </ul>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div
          id="message-input-container"
          className="qa-composer"
          data-temporary={temporary || undefined}
          onClick={(e) => {
            if (e.target === e.currentTarget) focus();
          }}
        >
          <div
            id="chat-input"
            className="qa-editable chat-editable"
            role="textbox"
            aria-multiline="true"
            contentEditable
            suppressContentEditableWarning
            data-placeholder={workspaceVoice.askPlaceholder}
            aria-label={workspaceVoice.askPlaceholder}
            aria-describedby={hintId}
            ref={input}
            onInput={(e) => {
              const draft = readDraftText(e.currentTarget);
              controller.setDraft(draft);
              if (!draft && !composing.current) e.currentTarget.replaceChildren();
            }}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
            }}
            onKeyDown={(e) => {
              const ime = e.nativeEvent.isComposing || composing.current || e.keyCode === 229;
              if (e.key !== "Enter" || ime) return;
              e.preventDefault();
              if (e.shiftKey) {
                if (typeof document.execCommand === "function")
                  document.execCommand("insertParagraph");
                return;
              }
              submit();
            }}
            onPaste={(e) => {
              e.preventDefault();
              const text = e.clipboardData.getData("text/plain");
              document.execCommand("insertText", false, text);
            }}
          />
          <div className="qa-composer-row">
            <div className="qa-composer-tools">
              <button
                ref={setDocsAnchor}
                type="button"
                className="ui-chip"
                aria-haspopup="dialog"
                aria-expanded={docsOpen}
                onClick={() => setDocsOpen((o) => !o)}
              >
                <IconBook size={15} />
                {docLabel}
              </button>
              <Tooltip
                side="top"
                content={
                  gk
                    ? "Used only when your documents can’t answer. Always labeled."
                    : "Off: answers come only from your documents."
                }
              >
                <button
                  type="button"
                  className="ui-chip qa-gk-chip"
                  aria-pressed={gk}
                  aria-busy={gkSaving || undefined}
                  onClick={toggleGeneral}
                >
                  {gkSaving ? <Spinner size={13} /> : <IconSparkle size={15} />}
                  General knowledge
                  <span className="ui-chip-state">{gk ? "On" : "Off"}</span>
                </button>
              </Tooltip>
            </div>
            <Tooltip content={sendLabel} side="top">
              <button
                id="send-message-button"
                type="submit"
                className="qa-send"
                aria-label={sendLabel}
                aria-disabled={!canSend}
                data-ready={canSend || undefined}
                onClick={(e) => {
                  // Disabled-but-focusable (keeps its explanation); Enter is the only way to queue.
                  if (!canSend) e.preventDefault();
                }}
              >
                {pending ? <Spinner size={16} /> : <IconArrowUp size={18} />}
              </button>
            </Tooltip>
          </div>
        </div>
      </form>
      {gkError && (
        <p className="qa-composer-error" role="alert">
          General knowledge setting: {gkError}
        </p>
      )}
      <p id={hintId} className="qa-composer-hint">
        {pending && hasDraft
          ? "Press Enter to queue this question. It’s asked when the current answer finishes."
          : temporary
            ? "Temporary chat: nothing here is saved to history, and follow-ups don’t remember earlier questions."
            : "Answers cite their pages. Check anything important against the original document."}
      </p>
      <Popover
        anchor={docsAnchor}
        open={docsOpen}
        onClose={() => setDocsOpen(false)}
        labelledBy={docsTitle}
        side="top"
        align="start"
        className="qa-docs-popover"
      >
        <h2 id={docsTitle} className="ui-popover-title">
          Answers use these documents
        </h2>
        {enabledDocs.length ? (
          <ul className="qa-docs-mini">
            {enabledDocs.map((d) => (
              <li key={d.document_id}>
                <IconBook size={14} />
                <span>{d.display_title ?? d.source_filename ?? "Untitled document"}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ui-popover-text">
            {active
              ? "No documents are switched on, so answers can’t come from your library."
              : docCount
                ? `${docLabel} in your library.`
                : "No documents are in your library yet."}
          </p>
        )}
        {offDocs > 0 && (
          <p className="ui-popover-text">
            {offDocs} more in your library {offDocs === 1 ? "is" : "are"} switched off.
          </p>
        )}
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setDocsOpen(false);
            navigate("/library");
          }}
        >
          Manage library
        </Button>
      </Popover>
    </div>
  );
}
