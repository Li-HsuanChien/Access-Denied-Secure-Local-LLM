import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PinnedModelProvider } from "../../desktop-shell/react/PinnedModel";
import { Composer } from "./Composer";
import { createChatController } from "./chatController";

function mount(pending = false) {
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
  const view = () => (
    <PinnedModelProvider>
      <Composer
        session={controller.getSnapshot()}
        controller={controller}
        pending={pending}
      />
    </PinnedModelProvider>
  );
  const result = render(view());
  controller.subscribe(() => result.rerender(view()));
  const input = screen.getByLabelText("Ask a question about your library…");
  const type = (text: string) => {
    input.textContent = text;
    fireEvent.input(input);
  };
  return { input, type, controller, questions };
}
afterEach(cleanup);
describe("chat composer", () => {
  it("portals expanded input outside transformed ancestors, retains edits, and closes with global Escape", () => {
    const previousOverflow = document.body.style.overflow;
    const x = mount();
    x.type("first\nsecond\nthird");
    fireEvent.click(screen.getByLabelText("Expand input"));
    const dialog = screen.getByRole("dialog", { name: "Input" });
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    expect(dialog.closest(".chat-composer")).toBeNull();
    expect(document.body.style.overflow).toBe("hidden");
    const editor = screen.getByRole("textbox", { name: "Type here..." });
    expect(editor.parentElement?.classList.contains("min-w-full")).toBe(true);
    expect(editor.parentElement?.classList.contains("input-prose")).toBe(true);
    expect(editor.textContent).toBe("firstsecondthird");
    editor.textContent = "edited draft";
    fireEvent.input(editor);
    const close = screen.getByRole("button", { name: "Close" });
    close.focus();
    fireEvent.keyDown(close, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(x.input.textContent).toBe("edited draft");
    expect(document.activeElement).toBe(x.input);
    expect(document.body.style.overflow).toBe(previousOverflow);
    expect(x.questions).toEqual([]);
  });
  it("starts the expanded caret at the draft end and preserves native Home/End and IME", () => {
    const x = mount();
    x.type("first\nsecond\nthird");
    fireEvent.click(screen.getByLabelText("Expand input"));
    const editor = screen.getByRole("textbox", { name: "Type here..." });
    expect(window.getSelection()?.anchorNode).toBe(editor.lastElementChild);
    expect(window.getSelection()?.anchorOffset).toBe(1);
    for (const key of [
      { key: "End" },
      { key: "Home" },
      { key: "End", ctrlKey: true },
      { key: "End", metaKey: true },
      { key: "End", ctrlKey: true, isComposing: true },
    ])
      expect(fireEvent.keyDown(editor, key)).toBe(true);
    expect(x.questions).toEqual([]);
  });
  it("round-trips structural blank paragraphs through the drawer and submits the same plain draft", () => {
    const x = mount();
    x.input.innerHTML = "first<div><br></div><div>third</div>";
    fireEvent.input(x.input);
    expect(x.controller.getSnapshot().draft).toBe("first\n\nthird");
    fireEvent.click(screen.getByLabelText("Expand input"));
    const editor = screen.getByRole("textbox", { name: "Type here..." });
    expect(Array.from(editor.children).map((p) => p.textContent)).toEqual([
      "first",
      "",
      "third",
    ]);
    editor.lastElementChild!.textContent = "third!";
    fireEvent.input(editor);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(Array.from(x.input.children).map((p) => p.textContent)).toEqual([
      "first",
      "",
      "third!",
    ]);
    fireEvent.keyDown(x.input, { key: "Enter" });
    expect(x.questions).toEqual(["first\n  \nthird!"]);
  });
  it("only closes the top modal and restores scroll on unmount", () => {
    document.body.style.overflow = "auto";
    const x = mount();
    x.type("first\nsecond\nthird");
    fireEvent.click(screen.getByLabelText("Expand input"));
    const otherModal = document.createElement("div");
    otherModal.className = "modal";
    document.body.append(otherModal);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeTruthy();
    otherModal.remove();
    cleanup();
    expect(document.body.style.overflow).toBe("auto");
    document.body.style.overflow = "";
  });
  it("clears explicit model commands without a picker or visible toast, as the minimal original shell does", () => {
    const x = mount();
    for (const command of ["/model secure-qa-local", "/model nonexistent"]) {
      x.type(command);
      fireEvent.keyDown(x.input, { key: "Enter" });
      expect(x.input.textContent).toBe("");
      expect(screen.queryByLabelText("Search In Models")).toBeNull();
    }
    expect(x.questions).toEqual([]);
  });

  it("retains the original mount-time context estimate and temporary label after answer presentation changes", () => {
    let n = 0;
    const controller = createChatController({
      createId: () => String(++n),
      now: () => 0,
      getPending: () => null,
      getGeneralKnowledge: () => true,
      ask: async () => new Promise(() => {}),
    });
    controller.submit("one");
    controller.setDraft("/status");
    const session = controller.getSnapshot();
    const view = render(
      <Composer session={session} controller={controller} pending={true} />,
    );
    const input = screen.getByLabelText("Ask a question about your library…");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("9 tokens")).toBeTruthy();
    const id = session.currentId!;
    view.rerender(
      <Composer
        session={{
          ...session,
          messages: {
            ...session.messages,
            [id]: {
              ...session.messages[id],
              content: "A completed answer with much more text.",
            },
          },
        }}
        controller={controller}
        pending={false}
      />,
    );
    expect(screen.getByText("9 tokens")).toBeTruthy();
    expect(screen.getByText("temporary:undefined")).toBeTruthy();
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
  it("keeps active-answer layout space without Stop or Send now and permits queued Enter/edit/delete", () => {
    const x = mount(true);
    x.type("queued");
    fireEvent.keyDown(x.input, { key: "Enter" });
    expect(x.controller.getSnapshot().queue).toHaveLength(1);
    expect(screen.queryByText("Stop")).toBeNull();
    expect(document.getElementById("send-message-button")).toBeNull();
    expect(screen.queryByLabelText("Send now")).toBeNull();
    fireEvent.click(screen.getByLabelText("Edit"));
    expect(x.input.textContent).toBe("queued");
    fireEvent.keyDown(x.input, { key: "Enter" });
    fireEvent.click(screen.getByLabelText("Delete"));
    expect(x.controller.getSnapshot().queue).toEqual([]);
  });
  it("opens the observed status and single model controls without asking a question", () => {
    const x = mount();
    x.type("/status");
    fireEvent.keyDown(x.input, { key: "Enter" });
    expect(screen.getByText("Context usage")).toBeTruthy();
    expect(screen.getByText("unknown")).toBeTruthy();
    x.type("/model");
    fireEvent.keyDown(x.input, { key: "Enter" });
    expect(screen.getByLabelText("Search In Models")).toBeTruthy();
    expect(screen.getByText("Set as default")).toBeTruthy();
    expect(x.questions).toEqual([]);
  });
});
