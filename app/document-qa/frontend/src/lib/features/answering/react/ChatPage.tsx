import { useI18n } from "@/react/i18n";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  useAnswering,
  useHealth,
  useNavigation,
  usePreferences,
  useServices,
} from "../../../../react/providers";
import type {
  ChatController,
  ChatSession,
  UserMessage as UserMessageType,
} from "../../react-contracts";
import { AssistantMessageView } from "../../answer-renderer/react/AssistantMessageView";
import { workspaceVoice } from "../../personality/presentation";
import {
  Button,
  IconButton,
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconCompose,
  IconCopy,
  IconTemporary,
  IconUpload,
} from "@/lib/features/design-system/react";
import {
  createChatController,
  messageCopyText,
  messageSiblings,
  visibleMessages,
} from "./chatController";
import { Composer } from "./Composer";
import { copyToClipboard } from "./clipboard";
import "./chat.css";

/** Starters fill the composer; the person finishes the question before sending it. */
const suggestions = [
  {
    title: ["Summarize the key points", "of a document in my library"],
    content: "Summarize the key points of ",
  },
  {
    title: ["Find the exact requirement", "and cite the page it comes from"],
    content: "What do my documents require for ",
  },
  {
    title: ["Compare two documents", "and show where they differ"],
    content: "Compare what my documents say about ",
  },
];
function useChatController(initialSession?: ChatSession) {
  const answering = useAnswering(),
    preferences = usePreferences(),
    services = useServices();
  const { route } = useNavigation();
  const current = useRef({ answering, preferences });
  current.current = { answering, preferences };
  const [controller] = useState(() =>
    createChatController({
      initialSession,
      temporary: route.temporary,
      createId: services.createId,
      now: services.now,
      ask: (request) => current.current.answering.ask(request),
      getPending: () => current.current.answering.state.pending,
      getGeneralKnowledge: () =>
        current.current.preferences.state.generalKnowledge,
    }),
  );
  const session = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  useEffect(() => {
    controller.activate();
    return () => controller.dispose();
  }, [controller]);
  useEffect(() => {
    controller.resume();
  }, [controller, answering.state.pending]);
  return { controller, session, pending: !!answering.state.pending };
}

function EmptyChat({
  temporary,
  composer,
  disabled,
  onSuggest,
}: {
  temporary: boolean;
  composer: React.ReactNode;
  disabled: boolean;
  onSuggest: (text: string) => void;
}) {
  const { health, readiness } = useHealth();
  const preferences = usePreferences();
  const { navigate } = useNavigation();
  const count = health?.library.document_count ?? null;
  const noDocs = readiness === "needs-documents" || count === 0;
  return (
    <div className="qa-empty">
      <div className="qa-hello">
        {temporary ? (
          <>
            <span className="qa-hello-icon" aria-hidden="true">
              <IconTemporary size={22} />
            </span>
            <h1 className="qa-hello-title">Temporary Chat</h1>
            <p className="qa-hello-sub">
              This chat is not saved; follow-up memory unavailable.
            </p>
          </>
        ) : (
          <>
            <h1 className="qa-hello-title">{workspaceVoice.homeTitle}</h1>
            <p className="qa-hello-sub">
              {noDocs
                ? preferences.state.generalKnowledge
                  ? "No documents are in your library yet, so I can only answer from general knowledge."
                  : "No documents are in your library yet. Add PDFs to get answers you can check page by page."
                : count
                  ? `I’ll answer from your ${count} ${count === 1 ? "document" : "documents"} and show you the page behind every claim.`
                  : "I’ll answer from your documents and show you the page behind every claim."}
            </p>
          </>
        )}
        {composer}
        {noDocs && !temporary && (
          <Button
            variant="secondary"
            icon={<IconUpload size={16} />}
            onClick={() => navigate("/library")}
          >
            Add PDFs to your library
          </Button>
        )}
        <ul className="qa-suggestions" aria-label="Suggested questions">
          {suggestions.map((s) => (
            <li key={s.content}>
              <button
                type="button"
                className="qa-suggestion chat-suggestion"
                disabled={disabled}
                onClick={() => onSuggest(s.content)}
              >
                <span className="qa-suggestion-label">{s.title[0]}</span>
                <span className="qa-suggestion-q">{s.title[1]}</span>
              </button>
            </li>
          ))}
        </ul>
        {/* LICENSE covers this Open WebUI identifier. https://docs.openwebui.com/license */}
        <p className="qa-version">Access Denied ‧ v0.11.4</p>
      </div>
    </div>
  );
}

export function ChatPage({ initialSession }: { initialSession?: ChatSession }) {
  const { t } = useI18n();
  const [isWebKit] = useState(
    () =>
      navigator.vendor === "Apple Computer, Inc." ||
      /^((?!chrome|android).)*safari/i.test(navigator.userAgent),
  );
  const { controller, session, pending } = useChatController(initialSession),
    { navigate, route } = useNavigation();
  const { readiness } = useHealth();
  useLayoutEffect(() => {
    document.title = "Access Denied";
  }, []);
  const [atBottom, setAtBottom] = useState(true);
  const [announce, setAnnounce] = useState("");
  const scroll = useRef<HTMLDivElement>(null),
    autoScroll = useRef(true);
  const messages = visibleMessages(session),
    empty = messages.length === 0;
  const last = messages.at(-1);
  const lastState = last?.role === "assistant" ? last.status : null;
  const awaiting = useRef(new Set<string>());
  useEffect(() => {
    // Announce the single pending status and then completion once per answer asked in this view
    // (not for restored threads). The persistent region is used because a role="status" element that
    // mounts with its text already present is not reliably announced.
    if (!last || last.role !== "assistant") return;
    if (lastState === "pending") {
      if (!awaiting.current.has(last.id)) setAnnounce(workspaceVoice.answerPending);
      awaiting.current.add(last.id);
      return;
    }
    if (!awaiting.current.delete(last.id)) return;
    setAnnounce(
      lastState === "error"
        ? "The answer could not be completed."
        : workspaceVoice.answerReady,
    );
  }, [last?.id, lastState]);
  const copy = async (text: string) => {
    await copyToClipboard(text);
  };
  useLayoutEffect(() => {
    const element = scroll.current;
    if (!autoScroll.current || !element) return;
    element.scrollTop = element.scrollHeight;
    // Account for content-visibility's next-frame layout.
    const frame = requestAnimationFrame(() => {
      if (autoScroll.current) element.scrollTop = element.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [session.messages, session.currentId]);
  const select = (parentId: string | null, childId: string) => {
    autoScroll.current = true;
    controller.selectBranch(parentId, childId);
  };
  const composer = (
    <Composer
      session={session}
      controller={controller}
      pending={pending}
      temporary={route.temporary}
    />
  );
  const liveRegion = (
    <p className="ui-sr-only" aria-live="polite">
      {announce}
    </p>
  );
  if (empty)
    return (
      <div
        id="chat-container"
        className="chat-react qa-chat qa-chat-empty"
        data-temporary={route.temporary || undefined}
      >
        <EmptyChat
          temporary={route.temporary}
          composer={composer}
          disabled={readiness === "unavailable"}
          onSuggest={(text) => {
            controller.setDraft(text);
            const input = document.getElementById("chat-input");
            if (input) {
              input.focus();
              // Caret to the end so the person can finish the question.
              const range = document.createRange();
              range.selectNodeContents(input);
              range.collapse(false);
              const sel = window.getSelection();
              sel?.removeAllRanges();
              sel?.addRange(range);
            }
          }}
        />
        {liveRegion}
      </div>
    );
  return (
    <div
      id="chat-container"
      className="chat-react qa-chat"
      data-temporary={route.temporary || undefined}
    >
      <div
        id="messages-container"
        ref={scroll}
        className="qa-thread-scroll"
        onScroll={() => {
          const el = scroll.current!;
          autoScroll.current =
            el.scrollHeight - el.scrollTop <= el.clientHeight + 5;
          setAtBottom(autoScroll.current);
        }}
      >
        <section className="qa-thread" aria-labelledby="chat-conversation">
          <h2 id="chat-conversation" className="ui-sr-only">
            {t("Chat Conversation")}
          </h2>
          {messages.map((message) => {
            const siblings = messageSiblings(session, message);
            return (
              <div
                key={message.id}
                className={`qa-turn message-listitem ${isWebKit ? "" : "message-virtualized"}`}
              >
                {message.role === "user" ? (
                  <UserMessageView
                    message={message}
                    session={session}
                    controller={controller}
                    pending={pending}
                    onCopy={() => copy(message.content)}
                    onSelectBranch={(id) => select(message.parentId, id)}
                  />
                ) : (
                  <AssistantMessageView
                    message={message}
                    branch={{
                      index: siblings.indexOf(message.id) + 1,
                      count: siblings.length,
                    }}
                    onNavigate={(path) => navigate(path)}
                    onCopy={() => copy(messageCopyText(message))}
                    onSelectBranch={(index) => {
                      const id =
                        siblings[
                          Math.max(0, Math.min(index - 1, siblings.length - 1))
                        ];
                      if (id) select(message.parentId, id);
                    }}
                    onSaveEdit={(text, asCopy) =>
                      controller.saveAssistantEdit(message.id, text, asCopy)
                    }
                    onRegenerate={(suggestion) => {
                      autoScroll.current = true;
                      controller.regenerate(message.id, suggestion);
                    }}
                    onDelete={() => controller.deleteAssistant(message.id)}
                    canRegenerate={!pending && readiness !== "unavailable"}
                    canDelete={!pending && siblings.length > 1}
                  />
                )}
              </div>
            );
          })}
        </section>
      </div>
      <div className="qa-chat-bottom chat-bottom-composer">
        {!atBottom && (
          <div className="qa-scroll-bottom">
            <IconButton
              label={t("Scroll to bottom")}
              tooltip={false}
              icon={<IconChevronDown size={18} />}
              onClick={() => {
                autoScroll.current = true;
                scroll.current?.scrollTo({
                  top: scroll.current.scrollHeight,
                  behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
                    ? "auto"
                    : "smooth",
                });
              }}
            />
          </div>
        )}
        {composer}
      </div>
      {liveRegion}
    </div>
  );
}

function UserMessageView({
  message,
  session,
  controller,
  pending,
  onCopy,
  onSelectBranch,
}: {
  message: UserMessageType;
  session: ChatSession;
  controller: ChatController;
  pending: boolean;
  onCopy: () => Promise<void>;
  onSelectBranch: (id: string) => void;
}) {
  const { t } = useI18n();
  const [edit, setEdit] = useState(false),
    [text, setText] = useState(message.content),
    [indexEdit, setIndexEdit] = useState(false),
    [copied, setCopied] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const siblings = messageSiblings(session, message),
    index = siblings.indexOf(message.id) + 1;
  useLayoutEffect(() => {
    if (edit && textarea.current) {
      textarea.current.focus();
      textarea.current.style.height = `${textarea.current.scrollHeight}px`;
    }
  }, [edit]);
  const save = (send: boolean) => {
    if (send) controller.sendUserEdit(message.id, text);
    else controller.saveUserEdit(message.id, text);
    setEdit(false);
  };
  return (
    <div
      className="qa-msg qa-msg-user user-message"
      id={`message-${message.id}`}
      style={{ scrollMarginTop: "3rem" }}
    >
      {edit ? (
        <div className="qa-edit qa-edit-user">
          <textarea
            id={`message-edit-${message.id}`}
            ref={textarea}
            aria-label="Edit message"
            className="qa-edit-input"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              e.target.style.height = "";
              e.target.style.height = `${e.target.scrollHeight}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEdit(false);
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                save(true);
              }
            }}
          />
          <div className="qa-edit-actions">
            <Button size="sm" variant="ghost" id="save-edit-message-button" onClick={() => save(false)}>
              {t("Save")}
            </Button>
            <span className="qa-edit-spacer" />
            <Button size="sm" variant="ghost" id="close-edit-message-button" onClick={() => setEdit(false)}>
              {t("Cancel")}
            </Button>
            <Button
              size="sm"
              variant="primary"
              id="confirm-edit-message-button"
              disabled={pending}
              onClick={() => save(true)}
            >
              {t("Send")}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="qa-bubble" dir="auto">
            {message.content}
          </div>
          <div className="qa-msg-actions qa-msg-actions-user">
            {siblings.length > 1 && (
              <div className="qa-branch" dir="ltr">
                <IconButton
                  size="sm"
                  tooltip={false}
                  label={t("Previous message")}
                  icon={<IconChevronLeft size={15} />}
                  onClick={() => onSelectBranch(siblings[Math.max(0, index - 2)])}
                />
                {indexEdit ? (
                  <span className="qa-branch-count">
                    <input
                      autoFocus
                      type="number"
                      aria-label="Message branch"
                      min={1}
                      max={siblings.length}
                      defaultValue={index}
                      onFocus={(e) => e.target.select()}
                      className="chat-branch-input renderer-branch-input"
                      onBlur={(e) => {
                        onSelectBranch(
                          siblings[
                            Math.max(0, Math.min(Number(e.target.value) - 1, siblings.length - 1))
                          ],
                        );
                        setIndexEdit(false);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                      }}
                    />
                    /{siblings.length}
                  </span>
                ) : (
                  <span className="qa-branch-count" onDoubleClick={() => setIndexEdit(true)}>
                    {index}/{siblings.length}
                  </span>
                )}
                <IconButton
                  size="sm"
                  tooltip={false}
                  label={t("Next message")}
                  icon={<IconChevronRight size={15} />}
                  onClick={() =>
                    onSelectBranch(siblings[Math.min(siblings.length - 1, index)])
                  }
                />
              </div>
            )}
            <IconButton
              size="sm"
              label={t("Edit")}
              className="edit-user-message-button"
              icon={<IconCompose size={16} />}
              onClick={() => {
                setText(message.content);
                setEdit(true);
              }}
            />
            <IconButton
              size="sm"
              label={copied ? t("Copied") : t("Copy")}
              icon={copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
              onClick={() =>
                void onCopy().then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1600);
                })
              }
            />
          </div>
        </>
      )}
    </div>
  );
}
