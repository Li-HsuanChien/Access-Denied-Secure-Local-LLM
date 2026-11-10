import type {
  Answering,
  ChatController,
  ChatMessage,
  ChatSession,
  MessageId,
  AssistantMessage,
  UserMessage,
  Answer,
  Immutable,
} from "../../react-contracts";
interface Dependencies {
  createId(): string;
  now(): number;
  ask: Answering["ask"];
  getPending(): Answering["state"]["pending"];
  getGeneralKnowledge(): boolean;
  initialSession?: ChatSession;
  temporary?: boolean;
}
/** Editable graph is mount-local; the answer and history-save lock is app-owned. */
export function createChatController(deps: Dependencies) {
  let session: ChatSession = deps.initialSession ?? {
    id: deps.createId(),
    messages: {},
    currentId: null,
    draft: "",
    queue: [],
  };
  let disposed = false,
    dispatching = false;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<ChatSession>) => {
    session = { ...session, ...patch };
    listeners.forEach((fn) => fn());
  };
  const change = (message: ChatMessage) =>
    update({ messages: { ...session.messages, [message.id]: message } });
  const add = (message: ChatMessage) => {
    const messages = { ...session.messages, [message.id]: message };
    if (message.parentId) {
      const parent = messages[message.parentId];
      messages[parent.id] = {
        ...parent,
        childIds: [...parent.childIds, message.id],
      };
    }
    update({ messages, currentId: message.id });
  };
  const deepest = (id: MessageId | null) => {
    const seen = new Set<string>();
    while (id && session.messages[id] && !seen.has(id)) {
      seen.add(id);
      const children = session.messages[id].childIds;
      if (!children.length) break;
      id = children.at(-1)!;
    }
    return id;
  };
  const askUser = async (user: UserMessage) => {
    if (disposed || dispatching || deps.getPending()) return;
    dispatching = true;
    const sessionId = session.id;
    const message: AssistantMessage = {
      id: deps.createId(),
      parentId: user.id,
      childIds: [],
      createdAt: deps.now(),
      role: "assistant",
      content: "",
      status: "pending",
      answer: null,
      error: null,
      historyWarning: null,
    };
    add(message);
    try {
      const result = await deps.ask({
        sessionId,
        conversationId: sessionId,
        ...(deps.temporary ? { temporary: true } : {}),
        question: user.content,
        generalKnowledge: deps.getGeneralKnowledge(),
      });
      if (disposed || session.id !== sessionId || !session.messages[message.id])
        return;
      change({
        ...message,
        status: result.answer.status === "failed" ? "error" : "complete",
        error:
          result.answer.status === "failed"
            ? (result.answer.error?.message ?? "The local workflow failed.")
            : null,
        answer: result.answer,
        // Warnings and the history notice render once, beside the answer (see answerNotices).
        content: formatAnswerForChat(result.answer),
        historyWarning: result.historyWarning,
      });
    } catch (error) {
      if (disposed || session.id !== sessionId || !session.messages[message.id])
        return;
      const failure = error instanceof Error ? error.message : String(error);
      change({ ...message, status: "error", content: "", error: failure });
    } finally {
      dispatching = false;
      resume();
    }
  };
  const submitNow = (question: string, parentId = session.currentId) => {
    const user: UserMessage = {
      id: deps.createId(),
      parentId,
      childIds: [],
      createdAt: deps.now(),
      role: "user",
      content: question,
    };
    add(user);
    void askUser(user);
  };
  const resume = () => {
    if (disposed || dispatching || deps.getPending() || !session.queue.length)
      return;
    const [next, ...rest] = session.queue;
    update({ queue: rest });
    submitNow(next.question);
  };
  const controller: ChatController = {
    get session() {
      return session;
    },
    setDraft(text) {
      if (!disposed) update({ draft: text });
    },
    submit(text = session.draft) {
      if (disposed || !text.trim()) return;
      update({ draft: "" });
      if (dispatching || deps.getPending()) {
        update({
          queue: [...session.queue, { id: deps.createId(), question: text }],
        });
        return;
      }
      submitNow(text);
    },
    editQueued(id) {
      const item = session.queue.find((q) => q.id === id);
      if (item)
        update({
          draft: item.question,
          queue: session.queue.filter((q) => q.id !== id),
        });
    },
    deleteQueued(id) {
      update({ queue: session.queue.filter((q) => q.id !== id) });
    },
    saveUserEdit(id, text) {
      const m = session.messages[id];
      if (m?.role === "user") change({ ...m, content: text });
    },
    sendUserEdit(id, text) {
      const m = session.messages[id];
      if (
        m?.role !== "user" ||
        !text.trim() ||
        dispatching ||
        deps.getPending()
      )
        return;
      submitNow(text, m.parentId);
    },
    saveAssistantEdit(id, text, asCopy) {
      const m = session.messages[id];
      if (m?.role !== "assistant" || m.status === "pending") return;
      if (asCopy)
        add({
          ...m,
          id: deps.createId(),
          createdAt: deps.now(),
          content: text,
          childIds: [],
        });
      else change({ ...m, content: text });
    },
    regenerate(id, _suggestion) {
      const m = session.messages[id];
      const user = m?.parentId ? session.messages[m.parentId] : null;
      if (
        m?.role !== "assistant" ||
        user?.role !== "user" ||
        disposed ||
        dispatching ||
        deps.getPending()
      )
        return;
      void askUser(user);
    },
    selectBranch(parentId, childId) {
      const child = session.messages[childId];
      if (child && child.parentId === parentId)
        update({ currentId: deepest(childId) });
    },
    deleteAssistant(id) {
      const m = session.messages[id];
      if (
        m?.role !== "assistant" ||
        disposed ||
        dispatching ||
        deps.getPending() ||
        messageSiblings(session, m).length < 2
      )
        return;
      const messages = { ...session.messages };
      const grandchildren = m.childIds.flatMap(
        (id) => messages[id]?.childIds ?? [],
      );
      if (m.parentId) {
        const parent = messages[m.parentId];
        messages[parent.id] = {
          ...parent,
          childIds: [
            ...parent.childIds.filter((x) => x !== id),
            ...grandchildren,
          ],
        };
      }
      for (const child of grandchildren)
        messages[child] = { ...messages[child], parentId: m.parentId };
      for (const child of [id, ...m.childIds]) delete messages[child];
      update({ messages });
      update({ currentId: deepest(m.parentId) });
    },
  };
  return {
    ...controller,
    get session() {
      return session;
    },
    getSnapshot: () => session,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    resume,
    activate: () => {
      disposed = false;
      resume();
    },
    dispose: () => {
      disposed = true;
      if (session.queue.length) update({ queue: [] });
    },
  };
}
export function visibleMessages(session: ChatSession): ChatMessage[] {
  const messages: ChatMessage[] = [];
  const seen = new Set<string>();
  let id = session.currentId;
  while (id && session.messages[id] && !seen.has(id)) {
    seen.add(id);
    const m: ChatMessage = session.messages[id];
    messages.push(m);
    id = m.parentId;
  }
  return messages.reverse();
}
export function messageSiblings(
  session: ChatSession,
  message: ChatMessage,
): readonly string[] {
  return message.parentId
    ? (session.messages[message.parentId]?.childIds ?? [])
    : Object.values(session.messages)
        .filter((m) => m.parentId === null)
        .map((m) => m.id);
}
export function conversationText(session: ChatSession) {
  return visibleMessages(session)
    .map((m) => `### ${m.role.toUpperCase()}\n${messageCopyText(m)}\n\n`)
    .join("")
    .trim();
}
export type AnswerBasis = "documents" | "general" | "none";
/** Exactly one basis per response; document claims win over legacy supplementary knowledge. */
export function answerBasis(answer: Immutable<Answer>): AnswerBasis {
  if (answer.documents.length) return "documents";
  return answer.general_knowledge ? "general" : "none";
}
/** Safety notices shown once beside the answer. The basis label already explains absent
 * evidence, and the history-save failure has its own note (AssistantMessage.historyWarning). */
export function answerNotices(answer: Immutable<Answer> | null): string[] {
  if (!answer || answer.status === "failed") return [];
  return [
    ...new Set(
      answer.warnings
        .filter((w) => w.code !== "insufficient_evidence" && w.code !== "history_save_failed")
        .map((w) => w.message)
        .filter(Boolean),
    ),
  ];
}
/** Whole-message copy: the (possibly edited) presentation plus the notices shown beside it. */
export function messageCopyText(message: ChatMessage): string {
  if (message.role !== "assistant") return message.content;
  const notes = [...answerNotices(message.answer), ...(message.historyWarning ? [message.historyWarning] : [])];
  return [message.content, ...notes.map((n) => `> ${n}`)].filter(Boolean).join("\n\n");
}
/** Select one evidence basis, including for older saved answers with both fields. */
export function formatAnswerForChat(answer: Immutable<Answer>): string {
  const parts: string[] = [];
  const citations = new Map(answer.citations.map((c, i) => [c.citation_id, i + 1]));
  if (answer.status === "failed") {
    parts.push(`> **The answer could not be completed.** ${answer.error?.message ?? "The local workflow failed."}`);
    if (answer.error?.hint) parts.push(answer.error.hint);
  }
  if (answer.documents.length) {
    parts.push(answer.documents.map(claim => {
      const refs = claim.citation_ids.filter(id => citations.has(id)).map(id => `[${citations.get(id)}]`).join(" ");
      return `${claim.text}${refs ? ` ${refs}` : ""}`;
    }).join("\n\n"));
  } else if (answer.general_knowledge) {
    parts.push(answer.general_knowledge);
  } else if (answer.status === "insufficient_evidence") {
    parts.push("I couldn’t find enough evidence in your documents to answer this question.");
  }
  parts.push(...answer.limitations);
  // Warnings are not part of the editable answer text: the view shows answerNotices() once.
  return [...new Set(parts.filter(Boolean))].join("\n\n") || "The local workflow returned no answer content.";
}
