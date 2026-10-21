import { useI18n } from "@/react/i18n";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Fuse from "fuse.js";
import {
  useAnswering,
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
import { ChatAnswer } from "../../answer-renderer/react/ChatAnswer";
import {
  createChatController,
  conversationText,
  messageSiblings,
  visibleMessages,
} from "./chatController";
import { Composer } from "./Composer";
import { ChatEntrance } from "./chatMotion";
import { NativeDropdown } from "@/lib/features/desktop-shell/react/NativeDropdown";
import { Icon } from "./icons";
import { Tooltip } from "./Tooltip";
import { copyToClipboard } from "./clipboard";
import "./chat.css";

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
function useChatController() {
  const answering = useAnswering(),
    preferences = usePreferences(),
    services = useServices();
  const current = useRef({ answering, preferences });
  current.current = { answering, preferences };
  const [controller] = useState(() =>
    createChatController({
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
export function ChatPage() {
  const { t } = useI18n();
  const [isWebKit] = useState(
    () =>
      navigator.vendor === "Apple Computer, Inc." ||
      /^((?!chrome|android).)*safari/i.test(navigator.userAgent),
  );
  const { controller, session, pending } = useChatController(),
    { navigate } = useNavigation();
  useLayoutEffect(() => {
    document.title = "Access Denied";
    // Original mounted MessageInput's hidden VoiceRecording handles Escape even while inactive.
    // Register with Chat before later-opened dropdowns, so their restore check sees composer focus.
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape")
        document.getElementById("chat-input")?.focus();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, []);
  const [orderedSuggestions] = useState(() =>
    [...suggestions].sort(() => Math.random() - 0.5),
  );
  const [menu, setMenu] = useState(false),
    [atBottom, setAtBottom] = useState(true);
  const scroll = useRef<HTMLDivElement>(null),
    autoScroll = useRef(true),
    menuRef = useRef<HTMLButtonElement>(null);
  const messages = visibleMessages(session),
    empty = messages.length === 0;
  const copy = async (text: string) => {
    await copyToClipboard(text);
  };
  useLayoutEffect(() => {
    const element = scroll.current;
    if (!autoScroll.current || !element) return;
    element.scrollTop = element.scrollHeight;
    // As in Messages.svelte, account for content-visibility's next-frame layout.
    const frame = requestAnimationFrame(() => {
      if (autoScroll.current) element.scrollTop = element.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [session.messages, session.currentId]);
  const select = (parentId: string | null, childId: string) => {
    autoScroll.current = true;
    controller.selectBranch(parentId, childId);
  };
  const matches =
    session.draft.length > 500
      ? []
      : session.draft.trim()
        ? new Fuse(orderedSuggestions, {
            keys: ["content", "title"],
            threshold: 0.5,
          })
            .search(session.draft.trim())
            .map((x) => x.item)
        : orderedSuggestions;
  const composer = (
    <Composer session={session} controller={controller} pending={pending} />
  );
  return (
    <div
      id="chat-container"
      className="chat-react h-full max-h-full w-full min-w-0 flex flex-col"
    >
      <ChatEntrance>
        <nav
          className={`chat-navbar sticky top-0 z-30 w-full pt-0.5 pb-1 -mb-12 flex flex-col items-center ${empty ? "chat-navbar-empty" : ""}`}
        >
          <div className="flex items-center w-full pl-1.5 pr-1">
            <div
              id="navbar-bg-gradient-to-b"
              className={`${empty ? "invisible" : "visible"} bg-linear-to-b via-40% to-97% from-white/90 via-white/50 to-transparent dark:from-gray-900/90 dark:via-gray-900/50 dark:to-transparent pointer-events-none absolute inset-0 -bottom-10 z-[-1]`}
            />
            <div
              aria-hidden="true"
              className="chat-native-sidebar-slot mr-1 flex-none self-center"
            />
            <div className="chat-nav-title flex-1 overflow-hidden max-w-full mt-0.5 py-0.5 pl-1">
              <div
                className={`flex min-w-0 items-center gap-2 ${empty ? "invisible" : ""}`}
              >
                <div className="truncate py-1 text-[0.9375rem] text-gray-700 dark:text-gray-300">
                  {t("New Chat")}
                </div>
                {!empty && (
                  <div className="relative">
                    <button
                      ref={menuRef}
                      id="chat-context-menu-button"
                      aria-label={t("Chat actions")}
                      className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-50/40 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800/40 dark:hover:text-gray-200"
                      onClick={(event) => {
                        event.preventDefault();
                        setMenu((v) => !v);
                      }}
                    >
                      <Icon
                        name="dots"
                        className="size-4.5"
                        strokeWidth="1.5"
                      />
                    </button>
                    <NativeDropdown
                      open={menu}
                      onOpenChange={setMenu}
                      triggerRef={menuRef}
                      sideOffset={8}
                    >
                      <div className="chat-actions-menu">
                        <button
                          id="chat-copy-button"
                          type="button"
                          onClick={() => {
                            void copy(conversationText(session));
                            setMenu(false);
                          }}
                        >
                          <Icon
                            name="copy"
                            className="size-3.5"
                            strokeWidth="1.5"
                          />
                          <div className="flex items-center">{t("Copy")}</div>
                        </button>
                      </div>
                    </NativeDropdown>
                  </div>
                )}
              </div>
            </div>
          </div>
          {!empty && (
            <div className="w-full text-center text-xs text-gray-500">
              {t("Temporary Chat")}
            </div>
          )}
        </nav>
        <div
          id="chat-pane"
          className="flex flex-col flex-auto z-10 w-full @container overflow-auto min-h-0"
        >
          {empty ? (
            <div className="flex items-center h-full">
              <div className="m-auto w-full max-w-[58rem] px-1 @2xl:px-20 translate-y-6 py-24 text-center">
                <Tooltip
                  className="w-full flex justify-center mb-0.5"
                  content={t(
                    "This chat won't appear in history and your messages will not be saved.",
                  )}
                >
                  <div className="flex items-center gap-1.5 text-gray-500 text-xs my-1 w-fit">
                    <Icon name="eye" className="size-3.5" />
                    {t("Temporary Chat")}
                  </div>
                </Tooltip>
                <div className="w-full text-3xl text-gray-800 dark:text-gray-100 text-center flex items-center gap-4">
                  <div className="w-full flex flex-col justify-center items-center">
                    <div className="flex flex-row justify-center gap-2.5 @sm:gap-3 w-fit px-5 max-w-xl">
                      <div className="flex shrink-0 justify-center">
                        <div className="flex -space-x-4 mb-0.5">
                          <button
                            aria-hidden="true"
                            aria-label={t(
                              "Get information on {{name}} in the UI",
                              { name: "Document Assistant" },
                            )}
                          >
                            <img
                              src="/favicon.png"
                              className="size-9 @sm:size-10 rounded-2xl"
                              alt=""
                              aria-hidden="true"
                              draggable="false"
                            />
                          </button>
                        </div>
                      </div>
                      <div className="text-2xl line-clamp-1 flex items-center">
                        <span className="line-clamp-1">Document Assistant</span>
                      </div>
                    </div>
                    <div className="flex mt-1 mb-2">
                      <div />
                    </div>
                    <div className="text-base font-normal @md:max-w-3xl w-full py-3">
                      <div className="bg-transparent">
                        <div className="max-w-[58rem] px-2 mx-auto">
                          {composer}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="mx-auto max-w-2xl mt-2">
                  <div className="mx-5">
                    <div className="mb-1 flex gap-1 text-xs font-normal items-center text-gray-600 dark:text-gray-400">
                      {matches.length ? (
                        <>
                          <Icon
                            name="bolt"
                            className="size-3"
                            strokeWidth="1.5"
                          />
                          {t("Suggested")}
                        </>
                      ) : (
                        <div className="flex w-full self-start text-center items-center justify-center">
                          {/* LICENSE covers this Open WebUI identifier. https://docs.openwebui.com/license */}
                          Access Denied ‧ v0.11.4
                        </div>
                      )}
                    </div>
                    <div className="h-36 w-full">
                      {matches.length > 0 && (
                        <div
                          role="list"
                          className="max-h-36 overflow-auto scrollbar-none items-start"
                        >
                          {matches.map((prompt, idx) => (
                            <button
                              role="listitem"
                              key={prompt.content}
                              className="chat-suggestion flex flex-col flex-1 shrink-0 w-full justify-between px-2.5 py-1.5 rounded-lg bg-transparent transition-colors hover:text-gray-950 dark:hover:text-white group"
                              style={{ animationDelay: `${idx * 45}ms` }}
                              onClick={() => {
                                autoScroll.current = true;
                                controller.submit(prompt.content);
                              }}
                            >
                              <div className="flex flex-col text-left leading-snug">
                                <div className="text-sm font-normal transition group-hover:text-gray-950 dark:text-gray-300 dark:group-hover:text-white line-clamp-1">
                                  {prompt.title[0]}
                                </div>
                                <div className="text-xs text-gray-600 group-hover:text-gray-900 dark:text-gray-400 dark:group-hover:text-gray-100 line-clamp-1">
                                  {prompt.title[1]}
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div
                id="messages-container"
                ref={scroll}
                className="pb-2.5 flex flex-col justify-between w-full flex-auto overflow-auto h-0 max-w-full z-10 scrollbar-hidden"
                onScroll={() => {
                  const el = scroll.current!;
                  autoScroll.current =
                    el.scrollHeight - el.scrollTop <= el.clientHeight + 5;
                  setAtBottom(autoScroll.current);
                }}
              >
                <div className="h-full w-full flex flex-col">
                  <div className="h-full flex pt-18">
                    <div className="w-full pt-2">
                      <section
                        className="w-full"
                        aria-labelledby="chat-conversation"
                      >
                        <h2 id="chat-conversation" className="sr-only">
                          {t("Chat Conversation")}
                        </h2>
                        <div
                          role="log"
                          aria-live="polite"
                          aria-relevant="additions"
                          aria-atomic="false"
                        >
                          {messages.map((message) => {
                            const siblings = messageSiblings(session, message);
                            return (
                              <div
                                role="listitem"
                                key={message.id}
                                className={`flex flex-col justify-between px-3.5 mb-3 w-full max-w-[58rem] mx-auto rounded-lg group message-listitem ${isWebKit ? "" : "message-virtualized"}`}
                              >
                                {message.role === "user" ? (
                                  <UserMessageView
                                    message={message}
                                    session={session}
                                    controller={controller}
                                    pending={pending}
                                    onCopy={() => copy(message.content)}
                                    onSelectBranch={(id) =>
                                      select(message.parentId, id)
                                    }
                                  />
                                ) : (
                                  <AssistantMessageView
                                    message={message}
                                    branch={{
                                      index: siblings.indexOf(message.id) + 1,
                                      count: siblings.length,
                                    }}
                                    onNavigate={(path) => navigate(path)}
                                    onCopy={() => copy(message.content)}
                                    onSelectBranch={(index) => {
                                      const id =
                                        siblings[
                                          Math.max(
                                            0,
                                            Math.min(
                                              index - 1,
                                              siblings.length - 1,
                                            ),
                                          )
                                        ];
                                      if (id) select(message.parentId, id);
                                    }}
                                    onSaveEdit={(text, asCopy) =>
                                      controller.saveAssistantEdit(
                                        message.id,
                                        text,
                                        asCopy,
                                      )
                                    }
                                    onRegenerate={(suggestion) => {
                                      autoScroll.current = true;
                                      controller.regenerate(
                                        message.id,
                                        suggestion,
                                      );
                                    }}
                                    onDelete={() =>
                                      controller.deleteAssistant(message.id)
                                    }
                                    canRegenerate={!pending}
                                    canDelete={!pending && siblings.length > 1}
                                  />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </section>
                      <div className="pb-18" />
                    </div>
                  </div>
                </div>
              </div>
              <div className="chat-bottom-composer pb-2 z-10 relative">
                {!atBottom && (
                  <div className="absolute -top-12 left-0 right-0 flex justify-center z-30 pointer-events-none">
                    <button
                      aria-label={t("Scroll to bottom")}
                      title={t("Scroll to bottom")}
                      className="bg-white border border-gray-100 dark:border-none dark:bg-white/20 p-1.5 rounded-full pointer-events-auto"
                      onClick={() => {
                        autoScroll.current = true;
                        scroll.current?.scrollTo({
                          top: scroll.current.scrollHeight,
                          behavior: "smooth",
                        });
                      }}
                    >
                      <svg
                        className="w-5 h-5"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <path
                          fillRule="evenodd"
                          clipRule="evenodd"
                          d="M10 3a.75.75 0 0 1 .75.75v10.638l3.96-4.158a.75.75 0 1 1 1.08 1.04l-5.25 5.5a.75.75 0 0 1-1.08 0l-5.25-5.5a.75.75 0 1 1 1.08-1.04l3.96 4.158V3.75A.75.75 0 0 1 10 3Z"
                        />
                      </svg>
                    </button>
                  </div>
                )}
                <div className="max-w-[58rem] px-2 mx-auto">{composer}</div>
              </div>
            </>
          )}
        </div>
      </ChatEntrance>
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
  const { navigate } = useNavigation();
  const [edit, setEdit] = useState(false),
    [text, setText] = useState(message.content),
    [indexEdit, setIndexEdit] = useState(false);
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
      className="flex w-full user-message group"
      id={`message-${message.id}`}
      style={{ scrollMarginTop: "3rem" }}
    >
      <div className="flex-auto w-0 max-w-full pl-1">
        <div className="chat-user w-full min-w-full">
          {edit ? (
            <div className="w-full bg-gray-50 dark:bg-gray-800 rounded-3xl px-4 py-3 mb-2">
              <div className="max-h-96 overflow-auto">
                <textarea
                  id={`message-edit-${message.id}`}
                  ref={textarea}
                  aria-label="Edit message"
                  className="bg-transparent outline-hidden w-full resize-none text-[0.9375rem]"
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
              </div>
              <div className="mt-2 -mx-1 flex justify-between text-sm">
                <button
                  id="save-edit-message-button"
                  className="px-2.5 py-1 border border-gray-100 dark:border-gray-700 text-gray-700 dark:text-gray-200 rounded-3xl"
                  onClick={() => save(false)}
                >
                  {t("Save")}
                </button>
                <div className="flex space-x-1.5">
                  <button
                    id="close-edit-message-button"
                    className="px-2.5 py-1 bg-white dark:bg-gray-900 rounded-3xl"
                    onClick={() => setEdit(false)}
                  >
                    {t("Cancel")}
                  </button>
                  <button
                    id="confirm-edit-message-button"
                    disabled={pending}
                    className="px-2.5 py-1 bg-gray-900 dark:bg-white text-gray-100 dark:text-gray-800 rounded-3xl"
                    onClick={() => save(true)}
                  >
                    {t("Send")}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="w-full">
                <div className="flex justify-end pb-1">
                  <div className="rounded-3xl max-w-[90%] px-4 py-1.5 bg-gray-50 dark:bg-gray-850">
                    <ChatAnswer
                      messageId={message.id}
                      content={message.content}
                      citations={[]}
                      onNavigate={(path) => navigate(path)}
                      onSaveContent={(content) =>
                        controller.saveUserEdit(message.id, content)
                      }
                    />
                  </div>
                </div>
              </div>
              <div className="flex justify-end text-gray-600 dark:text-gray-500">
                <time
                  dateTime={new Date(message.createdAt).toISOString()}
                  title={new Date(message.createdAt).toLocaleString(undefined, {
                    weekday: "long",
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                  className="hover-reveal mr-2 self-center text-[0.6875rem] tabular-nums text-gray-400 dark:text-gray-600 select-none"
                >
                  {new Date(message.createdAt).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </time>
                <Tooltip content={t("Edit")} placement="bottom">
                  <button
                    aria-label={t("Edit")}
                    className="hover-reveal p-1.5 rounded-lg edit-user-message-button"
                    onClick={() => {
                      setText(message.content);
                      setEdit(true);
                    }}
                  >
                    <Icon name="edit" className="size-4" strokeWidth="2.3" />
                  </button>
                </Tooltip>
                <Tooltip content={t("Copy")} placement="bottom">
                  <button
                    aria-label={t("Copy")}
                    className="hover-reveal p-1.5 rounded-lg"
                    onClick={() => void onCopy()}
                  >
                    <Icon name="copy" className="size-4" strokeWidth="2.3" />
                  </button>
                </Tooltip>
                {siblings.length > 1 && (
                  <div className="flex self-center" dir="ltr">
                    <button
                      aria-label={t("Previous message")}
                      className="self-center p-1 rounded-md"
                      onClick={() =>
                        onSelectBranch(siblings[Math.max(0, index - 2)])
                      }
                    >
                      <Icon
                        name="left"
                        className="size-3.5"
                        strokeWidth="2.5"
                      />
                    </button>
                    {indexEdit ? (
                      <div className="text-sm flex">
                        <input
                          autoFocus
                          type="number"
                          aria-label="Message branch"
                          min={1}
                          max={siblings.length}
                          defaultValue={index}
                          onFocus={(e) => e.target.select()}
                          className="chat-branch-input"
                          onBlur={(e) => {
                            onSelectBranch(
                              siblings[
                                Math.max(
                                  0,
                                  Math.min(
                                    Number(e.target.value) - 1,
                                    siblings.length - 1,
                                  ),
                                )
                              ],
                            );
                            setIndexEdit(false);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.currentTarget.blur();
                          }}
                        />
                        /{siblings.length}
                      </div>
                    ) : (
                      <div
                        className="text-sm tracking-widest"
                        onDoubleClick={() => setIndexEdit(true)}
                      >
                        {index}/{siblings.length}
                      </div>
                    )}
                    <button
                      aria-label={t("Next message")}
                      className="self-center p-1 rounded-md"
                      onClick={() =>
                        onSelectBranch(
                          siblings[Math.min(siblings.length - 1, index)],
                        )
                      }
                    >
                      <Icon
                        name="right"
                        className="size-3.5"
                        strokeWidth="2.5"
                      />
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
