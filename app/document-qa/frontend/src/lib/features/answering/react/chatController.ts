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
import { workspaceVoice } from "../../personality/presentation";
interface Dependencies {
  createId(): string;
  now(): number;
  ask: Answering["ask"];
  getPending(): Answering["state"]["pending"];
  getGeneralKnowledge(): boolean;
  initialSession?: ChatSession;
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
        content:
          formatAnswerForChat(result.answer) +
          (result.historyWarning ? `\n\n> ${result.historyWarning}` : ""),
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
    .map((m) => `### ${m.role.toUpperCase()}\n${m.content}\n\n`)
    .join("")
    .trim();
}
/** Ported formatter only; never calls the old adapter's request/save path. */
export function formatAnswerForChat(answer: Immutable<Answer>): string {
  const sections: string[] = [];
  const citations = new Map(answer.citations.map((c, i) => [c.citation_id, i + 1]));
  if (answer.status === "failed") {
    sections.push(
      `> **The answer could not be completed.** ${answer.error?.message ?? "The local workflow failed."}`,
    );
    if (answer.error?.hint) sections.push(`_${answer.error.hint}_`);
  }
  if (answer.status === "insufficient_evidence")
    sections.push(
      "> **There is not enough evidence in this library to answer this question.**",
    );
  if (answer.documents.length)
    sections.push(
      `### From your documents\n\n${answer.documents
        .map((claim) => {
          const refs = claim.citation_ids
            .map((id) => (citations.has(id) ? `[${citations.get(id)}]` : ""))
            .filter(Boolean)
            .join(" ");
          return `${claim.text}${refs ? ` ${refs}` : ""}`;
        })
        .join("\n\n")}`,
    );
  if (answer.general_knowledge)
    sections.push(
      `### General model knowledge\n\n${answer.general_knowledge}\n\n_${workspaceVoice.generalKnowledgeNotice}_`,
    );
  if (answer.limitations.length)
    sections.push(
      `### ${workspaceVoice.uncertaintyLabel}\n\n${answer.limitations.map((item) => `- ${item}`).join("\n")}`,
    );
  if (answer.warnings.length)
    sections.push(
      `> **Warnings**\n> ${answer.warnings.map((w) => w.message).join("\n> ")}`,
    );
  return (
    sections.join("\n\n") || "The local workflow returned no answer content."
  );
}
