import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppProviders, createAppRuntime } from "../../../../react/providers";
import type { AppServices } from "../../react-contracts";
import { Composer } from "./Composer";
import { createChatController } from "./chatController";

function mount(pending = false, services: Partial<Record<string, unknown>> = {}, temporary = false) {
  const questions: string[] = [];
  let n = 0;
  const controller = createChatController({
    createId: () => `id-${n++}`,
    now: () => 0,
    getPending: () =>
      pending ? { sessionId: "other", question: "waiting" } : null,
    getGeneralKnowledge: () => true,
    ask: async ({ question }) => {
      questions.push(question);
      return new Promise(() => {});
    },
  });
  const update = vi.fn(async ({ general_knowledge }: { general_knowledge: boolean }) => ({ general_knowledge }));
  const runtime = createAppRuntime({
    createId: () => "x",
    now: () => 0,
    settings: { read: async () => ({ general_knowledge: true }), update },
    history: { enabled: async () => true },
    answering: {},
    library: {
      versions: async () => ({
        active: "v1",
        versions: [{ version_id: "v1", status: "active", created_at: "", document_count: 2, chunk_count: 3, documents: [
          { document_id: "d1", source_filename: "a.pdf", display_title: "Handbook", page_count: 3, enabled: true },
          { document_id: "d2", source_filename: "b.pdf", display_title: "Old policy", page_count: 2, enabled: false },
        ] }],
      }),
    },
    ...services,
  } as unknown as AppServices);
  const view = () => (
    <AppProviders runtime={runtime}>
      <Composer
        session={controller.getSnapshot()}
        controller={controller}
        pending={pending}
        temporary={temporary}
      />
    </AppProviders>
  );
  const result = render(view());
  controller.subscribe(() => result.rerender(view()));
  const input = screen.getByLabelText("Ask a question about your library…");
  const type = (text: string) => {
    input.textContent = text;
    fireEvent.input(input);
  };
  return { input, type, controller, questions, runtime, update };
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe("chat composer", () => {
  it("is a labelled multi-line text box that takes focus on mount", () => {
    const x = mount();
    expect(x.input.getAttribute("role")).toBe("textbox");
    expect(x.input.getAttribute("aria-multiline")).toBe("true");
    expect(document.activeElement).toBe(x.input);
    expect(x.input.getAttribute("aria-describedby")).toBeTruthy();
  });
  it("submits structural blank paragraphs as the same plain draft", () => {
    const x = mount();
    x.input.innerHTML = "first<div><br></div><div>third!</div>";
    fireEvent.input(x.input);
    expect(x.controller.getSnapshot().draft).toBe("first\n\nthird!");
    fireEvent.keyDown(x.input, { key: "Enter" });
    expect(x.questions).toEqual(["first\n  \nthird!"]);
  });
  it("treats slash text as an ordinary question (no parity command palette)", () => {
    const x = mount();
    x.type("/status");
    expect(screen.queryByRole("listbox", { name: "Commands" })).toBeNull();
    fireEvent.keyDown(x.input, { key: "Enter" });
    expect(x.questions).toEqual(["/status"]);
    expect(screen.queryByText("Context usage")).toBeNull();
  });
  it("ignores composing Enter and sends once after composition ends", () => {
    const x = mount();
    fireEvent.compositionStart(x.input);
    x.type("質問");
    fireEvent.keyDown(x.input, {
      key: "Enter",
      keyCode: 229,
      isComposing: true,
    });
    expect(x.questions).toEqual([]);
    fireEvent.compositionEnd(x.input);
    fireEvent.keyDown(x.input, { key: "Enter" });
    expect(x.questions).toEqual(["質問"]);
    expect(x.input.textContent).toBe("");
  });
  it("leaves Shift+Enter as an editing key and submits ordinary Enter", () => {
    const x = mount();
    x.type("line one\nline two");
    fireEvent.keyDown(x.input, { key: "Enter", shiftKey: true });
    expect(x.questions).toEqual([]);
    fireEvent.keyDown(x.input, { key: "Enter" });
    expect(x.questions).toEqual(["line one\nline two"]);
  });
  it("explains the disabled send button and does not send an empty draft", () => {
    const x = mount();
    const send = document.getElementById("send-message-button")!;
    expect(send.getAttribute("aria-disabled")).toBe("true");
    expect(send.getAttribute("aria-label")).toBe("Type a question to send");
    fireEvent.click(send);
    expect(x.questions).toEqual([]);
    x.type("ready");
    expect(send.getAttribute("aria-disabled")).toBe("false");
    fireEvent.click(send);
    expect(x.questions).toEqual(["ready"]);
  });
  it("has no Stop or Send now while an answer runs, and queues Enter with edit/delete", () => {
    const x = mount(true);
    x.type("queued");
    const send = document.getElementById("send-message-button")!;
    expect(send.getAttribute("aria-disabled")).toBe("true");
    expect(send.getAttribute("aria-label")).toBe("Wait for the current answer to finish");
    expect(screen.getByText(/Press Enter to queue this question/)).toBeTruthy();
    fireEvent.click(send);
    expect(x.controller.getSnapshot().queue).toHaveLength(0);
    fireEvent.keyDown(x.input, { key: "Enter" });
    expect(x.controller.getSnapshot().queue).toHaveLength(1);
    expect(x.questions).toEqual([]);
    expect(screen.queryByText("Stop")).toBeNull();
    expect(screen.queryByLabelText("Send now")).toBeNull();
    fireEvent.click(screen.getByLabelText("Edit"));
    expect(x.input.textContent).toBe("queued");
    fireEvent.keyDown(x.input, { key: "Enter" });
    fireEvent.click(screen.getByLabelText("Delete"));
    expect(x.controller.getSnapshot().queue).toEqual([]);
  });
  it("pauses sending while the local model is unavailable and offers Check again", async () => {
    const health = vi.fn().mockRejectedValueOnce(new Error("Model not running.")).mockResolvedValue({
      ready: true, answering: { ready: true }, library: { document_count: 1, chunk_count: 1 },
    });
    const x = mount(false, { answering: { health } });
    await act(async () => { await x.runtime.health.refresh(); });
    expect(screen.getByRole("status").textContent).toContain("Model not running.");
    x.type("blocked");
    fireEvent.keyDown(x.input, { key: "Enter" });
    expect(x.questions).toEqual([]);
    expect(document.getElementById("send-message-button")!.getAttribute("aria-label")).toBe(
      "Answers are paused until the local model is ready",
    );
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(screen.queryByText(/Answers are paused/)).toBeNull());
    fireEvent.keyDown(x.input, { key: "Enter" });
    expect(x.questions).toEqual(["blocked"]);
  });
  it("binds the general-knowledge chip to the committed preference", async () => {
    const x = mount();
    const chip = screen.getByRole("button", { name: /General knowledge/ });
    await waitFor(() => expect(chip.getAttribute("aria-pressed")).toBe("true"));
    fireEvent.click(chip);
    await waitFor(() => expect(x.update).toHaveBeenCalledWith({ general_knowledge: false }));
    await waitFor(() => expect(chip.getAttribute("aria-pressed")).toBe("false"));
    expect(chip.textContent).toContain("Off");
  });
  it("lists the documents in use from the existing library listing", async () => {
    mount();
    const chip = screen.getByRole("button", { name: "Documents" });
    fireEvent.click(chip);
    const popover = await screen.findByRole("dialog", { name: "Answers use these documents" });
    await waitFor(() => expect(popover.textContent).toContain("Handbook"));
    expect(popover.textContent).not.toContain("Old policy");
    expect(popover.textContent).toContain("1 more in your library is switched off.");
    expect(chip.getAttribute("aria-expanded")).toBe("true");
  });
  it("marks a temporary chat composer and explains it in the hint", () => {
    mount(false, {}, true);
    expect(document.getElementById("message-input-container")!.hasAttribute("data-temporary")).toBe(true);
    expect(screen.getByText(/nothing here is saved to history/)).toBeTruthy();
  });
});
