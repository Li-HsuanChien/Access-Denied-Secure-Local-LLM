import { initReactI18n } from "@/react/i18n";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { ChatAnswer } from "./ChatAnswer";
import { AssistantMessageView } from "./AssistantMessageView";
import { EditorView } from "@codemirror/view";
import { act } from "@testing-library/react";
import { createFixtureAnsweringClient } from "../../answering/fixtureAnsweringClient";
import type { AssistantMessage } from "../../react-contracts/chat";
const message: AssistantMessage = {
  id: "answer",
  parentId: "question",
  childIds: [],
  createdAt: 1792504800000,
  content: "### From your documents\nA safe claim. [^S1]",
  role: "assistant",
  status: "complete",
  answer: null,
  historyWarning: null,
  error: null,
};
beforeAll(async () => {
  localStorage.setItem("locale", "en-US");
  await initReactI18n();
});
afterEach(cleanup);
describe("native chat renderer", () => {
  it("keeps quoted/list code saves local while root saves update only the matching whole-message fence", () => {
    const content =
      "> ```js\n> const quoted = 1;\n> ```\n\n- Item\n\n  ```js\n  const listed = 1;\n  ```\n\n```js\nconst top = 2;\n```\n";
    const save = vi.fn();
    const { container } = render(
      <ChatAnswer
        messageId="fences"
        content={content}
        citations={[]}
        onNavigate={vi.fn()}
        onSaveContent={save}
      />,
    );
    const blocks = [
      ...container.querySelectorAll<HTMLElement>(".renderer-code"),
    ];
    expect(blocks).toHaveLength(3);
    const editAndSave = (index: number, value: string) => {
      const view = EditorView.findFromDOM(
        blocks[index].querySelector(".cm-editor")!,
      )!;
      act(() =>
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: value },
        }),
      );
      fireEvent.click(
        within(blocks[index]).getByRole("button", { name: /^Save$/ }),
      );
      expect(
        within(blocks[index]).getByRole("button", { name: "Saved" }),
      ).toBeTruthy();
      expect(view.state.doc.toString()).toBe(value);
    };
    editAndSave(0, "const editedQuote = 10;");
    editAndSave(1, "const editedList = 11;");
    expect(save).not.toHaveBeenCalled();
    expect(
      EditorView.findFromDOM(
        blocks[2].querySelector(".cm-editor")!,
      )!.state.doc.toString(),
    ).toBe("const top = 2;");
    editAndSave(2, "const editedTop = 12;");
    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith(
      content.replace("const top = 2;", "const editedTop = 12;"),
    );
  });
  it("renders semantic Markdown, inert footnotes, writing/alert/details extensions, and safe links", () => {
    const navigate = vi.fn();
    const { container } = render(
      <ChatAnswer
        messageId="rich"
        citations={[]}
        onSaveContent={vi.fn()}
        onNavigate={navigate}
        content={
          '### Heading\n\n**bold** and $x^2$ [^S1]\n\n[Local](/library) [External](https://evil.test)\n\n:::writing{subject="Baseline note"}\nA note\n:::\n\n> [!WARNING]\n> Be careful\n\n<details>\n<summary>More</summary>\n**Detail**\n</details>\n\n<details><summary>Literal</summary>one line</details>'
        }
      />,
    );
    expect(screen.getByRole("heading", { name: "Heading" })).toBeTruthy();
    expect(container.querySelector(".katex")).toBeTruthy();
    expect(container.querySelector("sup")?.textContent).toBe("S1");
    expect(container.querySelector("sup a")).toBeNull();
    expect(screen.getByText("Baseline note")).toBeTruthy();
    expect(screen.getByText("WARNING")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "More" })
        .getAttribute("aria-expanded"),
    ).toBe("false");
    expect(
      screen.getByText("<details><summary>Literal</summary>one line</details>"),
    ).toBeTruthy();
    fireEvent.click(screen.getByText("Local"));
    expect(navigate).toHaveBeenCalledWith("/library");
    expect(screen.getByText("External").hasAttribute("href")).toBe(false);
  });
  it("delegates assistant edit/save-as-copy, branch selection, regeneration and confirmed deletion", () => {
    const save = vi.fn(),
      regenerate = vi.fn(),
      remove = vi.fn(),
      branch = vi.fn();
    render(
      <AssistantMessageView
        message={message}
        branch={{ index: 2, count: 2 }}
        onNavigate={vi.fn()}
        onCopy={vi.fn(async () => {})}
        onSelectBranch={branch}
        onSaveEdit={save}
        onRegenerate={regenerate}
        onDelete={remove}
        canRegenerate
        canDelete
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Edit$/ }));
    const editor = screen.getByRole("textbox", { name: "Edit message" });
    fireEvent.change(editor, { target: { value: "Edited presentation" } });
    fireEvent.click(screen.getByRole("button", { name: "Save As Copy" }));
    expect(save).toHaveBeenCalledWith("Edited presentation", true);
    fireEvent.click(screen.getByRole("button", { name: "Previous message" }));
    expect(branch).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    fireEvent.click(screen.getByRole("button", { name: "More Concise" }));
    expect(regenerate).toHaveBeenCalledWith("More Concise");
    fireEvent.click(screen.getByRole("button", { name: /^Delete$/ }));
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(remove).toHaveBeenCalledOnce();
  });
  it("keeps validated source quotes separate from edits and closes the quote modal with Escape", async () => {
    const answer = await createFixtureAnsweringClient({ delay: 0 }).ask(
      "source",
      true,
    );
    const save = vi.fn();
    const original = JSON.stringify(answer);
    render(
      <AssistantMessageView
        message={{ ...message, answer }}
        branch={{ index: 1, count: 1 }}
        onNavigate={vi.fn()}
        onCopy={vi.fn(async () => {})}
        onSelectBranch={vi.fn()}
        onSaveEdit={save}
        onRegenerate={vi.fn()}
        onDelete={vi.fn()}
        canRegenerate
        canDelete={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Toggle 1 source" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "View source: QA Reference Guide · p. 2",
      }),
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("(page 2)")).toBeTruthy();
    expect(within(dialog).getByText(answer.citations[0].quote)).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Edit$/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Edit message" }), {
      target: { value: "Changed presentation" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    expect(save).toHaveBeenCalledWith("Changed presentation", false);
    expect(JSON.stringify(answer)).toBe(original);
  });
  it("retains the pending assistant cursor with no action bar", () => {
    render(
      <AssistantMessageView
        message={{ ...message, status: "pending", content: "" }}
        branch={{ index: 1, count: 1 }}
        onNavigate={vi.fn()}
        onCopy={vi.fn(async () => {})}
        onSelectBranch={vi.fn()}
        onSaveEdit={vi.fn()}
        onRegenerate={vi.fn()}
        onDelete={vi.fn()}
        canRegenerate={false}
        canDelete={false}
      />,
    );
    expect(screen.getByLabelText("Answer in progress")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("preserves blocked iframe geometry without constructing resource nodes", () => {
    const { container } = render(
      <ChatAnswer
        messageId="blocked"
        citations={[]}
        onSaveContent={vi.fn()}
        onNavigate={vi.fn()}
        content={
          '![remote](http://127.0.0.1:8765/health)\n\n<iframe src="https://evil.test"></iframe>'
        }
      />,
    );
    expect(screen.getByText("Image unavailable")).toBeTruthy();
    expect(container.querySelector("iframe,img")).toBeNull();
    expect(screen.getByTitle("Embedded content")).toBeTruthy();
  });
});
