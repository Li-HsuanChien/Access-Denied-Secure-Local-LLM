import { describe, expect, it, vi } from "vitest";
import type { Answer, AnsweringState } from "../../react-contracts";
import { createAnswering } from "../../../../react/providers/answering";
import {
  createChatController,
  visibleMessages,
  messageSiblings,
  conversationText,
} from "./chatController";
import type { AppServices } from "../../react-contracts";

const answer: Answer = {
  schema_version: "1.0.0",
  request_id: "a1",
  question: "first",
  status: "answered",
  evidence_mode: "none",
  documents: [],
  citations: [],
  evidence: [],
  general_knowledge: "An answer",
  limitations: [],
  warnings: [],
  model: null,
  collection_version: null,
  prompt_version: "test",
  timing: {
    retrieval_ms: 0,
    generation_ms: 0,
    total_ms: 0,
    attempts: 1,
    prompt_tokens: null,
    completion_tokens: null,
  },
  error: null,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
function setup() {
  let n = 0,
    generalKnowledge = true;
  const requests: {
    question: string;
    generalKnowledge: boolean;
    result: ReturnType<typeof deferred<Answer>>;
  }[] = [];
  const saved: unknown[] = [];
  const services = {
    createId: () => `id-${++n}`,
    now: () => 1760000000000,
    answering: {
      ask: (question: string, gk: boolean) => {
        const result = deferred<Answer>();
        requests.push({ question, generalKnowledge: gk, result });
        return result.promise;
      },
    },
    history: {
      save: async (...args: unknown[]) => {
        saved.push(args);
        return true;
      },
    },
  } as unknown as AppServices;
  const coordinator = createAnswering(services);
  const make = () =>
    createChatController({
      createId: services.createId,
      now: services.now,
      ask: coordinator.ask,
      getPending: () => coordinator.getSnapshot().pending,
      getGeneralKnowledge: () => generalKnowledge,
    });
  const controller = make();
  coordinator.subscribe(() => controller.resume());
  const finish = async (index: number) => {
    requests[index].result.resolve({
      ...answer,
      request_id: `a${index}`,
      question: requests[index].question,
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    await Promise.resolve();
    await Promise.resolve();
  };
  return {
    controller,
    coordinator,
    make,
    requests,
    saved,
    finish,
    setGK: (value: boolean) => (generalKnowledge = value),
  };
}
describe("mount-local chat controller", () => {
  it("retains failed workflow Markdown and the original local error chrome", async () => {
    let n = 0;
    const c = createChatController({
      createId: () => String(++n),
      now: () => 0,
      getPending: () => null,
      getGeneralKnowledge: () => true,
      ask: async () => ({
        answer: {
          ...answer,
          status: "failed",
          error: {
            code: "failed",
            message: "The local workflow failed.",
            hint: "Retry.",
          },
        },
        historyWarning: null,
      }),
    });
    c.submit("question");
    await vi.waitFor(() =>
      expect(visibleMessages(c.getSnapshot())[1]).toMatchObject({
        status: "error",
        error: "The local workflow failed.",
      }),
    );
    expect(visibleMessages(c.getSnapshot())[1].content).toContain(
      "The answer could not be completed.",
    );
  });
  it("keeps the history warning in transient Markdown and whole-message copy", async () => {
    let n = 0;
    const c = createChatController({
      createId: () => String(++n),
      now: () => 0,
      getPending: () => null,
      getGeneralKnowledge: () => true,
      ask: async () => ({
        answer,
        historyWarning: "This answer could not be saved.",
      }),
    });
    c.submit("question");
    await vi.waitFor(() =>
      expect(visibleMessages(c.getSnapshot())[1].content).toContain(
        "> This answer could not be saved.",
      ),
    );
    expect(conversationText(c.getSnapshot())).toContain(
      "> This answer could not be saved.",
    );
  });
  it("sends only the latest question and drains FIFO using committed preferences at dispatch", async () => {
    const x = setup();
    x.controller.submit("first");
    x.controller.submit("second");
    x.controller.submit("third");
    expect(x.requests.map((x) => x.question)).toEqual(["first"]);
    expect(x.controller.getSnapshot().queue).toHaveLength(2);
    x.setGK(false);
    await x.finish(0);
    await vi.waitFor(() => expect(x.requests).toHaveLength(2));
    expect(x.requests[1]).toMatchObject({
      question: "second",
      generalKnowledge: false,
    });
    await x.finish(1);
    await vi.waitFor(() => expect(x.requests).toHaveLength(3));
    await x.finish(2);
    expect(
      visibleMessages(x.controller.getSnapshot()).map((m) => m.role),
    ).toEqual(["user", "assistant", "user", "assistant", "user", "assistant"]);
    expect(x.saved).toHaveLength(0);
  });
  it("edits and deletes queued questions without dispatching them", () => {
    const x = setup();
    x.controller.submit("first");
    x.controller.submit("edit me");
    x.controller.submit("delete me");
    const [a, b] = x.controller.getSnapshot().queue;
    x.controller.editQueued(a.id);
    x.controller.deleteQueued(b.id);
    expect(x.controller.getSnapshot().draft).toBe("edit me");
    expect(x.controller.getSnapshot().queue).toEqual([]);
    expect(x.requests).toHaveLength(1);
  });
  it("drops unsent work and ignores late completion after disposal while the coordinator saves once", async () => {
    const x = setup();
    x.controller.submit("old");
    x.controller.submit("discard");
    const old = x.controller.getSnapshot();
    x.controller.dispose();
    const fresh = x.make();
    fresh.submit("new");
    expect(x.requests).toHaveLength(1);
    expect(fresh.getSnapshot().queue).toHaveLength(1);
    await x.finish(0);
    expect(x.controller.getSnapshot().messages).toBe(old.messages);
    expect(x.controller.getSnapshot().queue).toEqual([]);
    fresh.resume();
    await vi.waitFor(() => expect(x.requests).toHaveLength(2));
    expect(x.requests[1].question).toBe("new");
    await x.finish(1);
    expect(x.saved).toHaveLength(0);
  });
  it("keeps assistant edits and copies separate from the immutable answer and saved history", async () => {
    const x = setup();
    x.controller.submit("first");
    await x.finish(0);
    const original = visibleMessages(x.controller.getSnapshot())[1];
    x.controller.saveAssistantEdit(original.id, "Edited ```code```", false);
    x.controller.saveAssistantEdit(original.id, "Copy", true);
    const session = x.controller.getSnapshot();
    const copy = session.messages[session.currentId!];
    expect(copy.content).toBe("Copy");
    expect(messageSiblings(session, copy)).toHaveLength(2);
    expect(copy.role === "assistant" && copy.answer?.general_knowledge).toBe(
      "An answer",
    );
    expect(x.saved).toHaveLength(0);
    expect(x.requests).toHaveLength(1);
    x.controller.selectBranch(original.parentId, original.id);
    expect(visibleMessages(x.controller.getSnapshot())[1].content).toBe(
      "Edited ```code```",
    );
    expect(conversationText(x.controller.getSnapshot())).toContain(
      "### ASSISTANT\nEdited ```code```",
    );
  });
  it("creates sibling questions for user Send and reasks selected question on regeneration", async () => {
    const x = setup();
    x.controller.submit("first");
    await x.finish(0);
    let [user, assistant] = visibleMessages(x.controller.getSnapshot());
    x.controller.saveUserEdit(user.id, "presentation");
    expect(x.requests).toHaveLength(1);
    x.controller.sendUserEdit(user.id, "replacement");
    expect(x.requests[1].question).toBe("replacement");
    await x.finish(1);
    [user, assistant] = visibleMessages(x.controller.getSnapshot());
    expect(messageSiblings(x.controller.getSnapshot(), user)).toHaveLength(2);
    x.controller.regenerate(assistant.id, "Add Details");
    expect(x.requests[2].question).toBe("replacement");
    await x.finish(2);
    expect(
      messageSiblings(
        x.controller.getSnapshot(),
        visibleMessages(x.controller.getSnapshot())[1],
      ),
    ).toHaveLength(2);
  });
  it("selects deepest branch and deletes assistant with its immediate child, reconnecting grandchildren", async () => {
    const x = setup();
    x.controller.submit("one");
    await x.finish(0);
    const original = visibleMessages(x.controller.getSnapshot())[1];
    x.controller.regenerate(original.id);
    await x.finish(1);
    const second = visibleMessages(x.controller.getSnapshot())[1];
    x.controller.submit("two");
    await x.finish(2);
    const tail = visibleMessages(x.controller.getSnapshot()).at(-1)!;
    x.controller.selectBranch(original.parentId, original.id);
    expect(x.controller.getSnapshot().currentId).toBe(original.id);
    x.controller.selectBranch(second.parentId, second.id);
    expect(x.controller.getSnapshot().currentId).toBe(tail.id);
    x.controller.deleteAssistant(second.id);
    expect(x.controller.getSnapshot().messages[second.id]).toBeUndefined();
    expect(x.controller.getSnapshot().messages[tail.id].parentId).toBe(
      original.parentId,
    );
  });
});
