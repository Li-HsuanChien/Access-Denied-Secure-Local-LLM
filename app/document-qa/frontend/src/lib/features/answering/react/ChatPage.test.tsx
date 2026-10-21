import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { AppProviders, createAppRuntime } from "../../../../react/providers";
import type {
  Answer,
  AppServices,
  AssistantMessageViewProps,
  ChatAnswerProps,
} from "../../react-contracts";
import { ChatPage } from "./ChatPage";
// Exercise the controller/composer boundary independently of the separately owned rich parser.
vi.mock("../../answer-renderer/react/ChatAnswer", () => ({
  ChatAnswer: ({ content }: ChatAnswerProps) => (
    <div className="markdown-prose">{content}</div>
  ),
}));
vi.mock("../../answer-renderer/react/AssistantMessageView", () => ({
  AssistantMessageView: ({ message, onCopy }: AssistantMessageViewProps) => (
    <div data-testid="assistant">
      {message.content}
      <button aria-label="Copy assistant" onClick={() => void onCopy()}>
        Copy
      </button>
    </div>
  ),
}));
const answer: Answer = {
  schema_version: "1.0.0",
  request_id: "request",
  question: "question",
  status: "answered",
  evidence_mode: "none",
  documents: [],
  citations: [],
  evidence: [],
  general_knowledge: "Response",
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
function setup() {
  let n = 0;
  const requests: string[] = [],
    saves: string[] = [];
  let finish!: () => void;
  const response = new Promise<Answer>(
    (resolve) => (finish = () => resolve(answer)),
  );
  const services = {
    createId: () => `id-${++n}`,
    now: () => 1760000000000,
    answering: {
      ask: async (question: string) => {
        requests.push(question);
        return response;
      },
    },
    settings: { read: async () => ({ general_knowledge: true }) },
    history: {
      enabled: async () => true,
      save: async (_id: string, question: string) => {
        saves.push(question);
        return true;
      },
    },
  } as unknown as AppServices;
  const runtime = createAppRuntime(services);
  const renderPage = (key = "a") => (
    <StrictMode>
      <AppProviders runtime={runtime}>
        <ChatPage key={key} />
      </AppProviders>
    </StrictMode>
  );
  const mounted = render(renderPage());
  return { requests, saves, finish, runtime, mounted, renderPage };
}
function type(text: string) {
  const input = screen.getByLabelText("Ask a question about your library…");
  input.textContent = text;
  fireEvent.input(input);
  return input;
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe("rendered Chat page controller integration", () => {
  it("preserves message containment in Chromium and excludes original WebKit engines", () => {
    vi.spyOn(navigator, "vendor", "get").mockReturnValue("Google Inc.");
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Chrome/151");
    const x = setup();
    fireEvent.keyDown(type("contained"), { key: "Enter" });
    expect(
      document.querySelector(".message-listitem.message-virtualized"),
    ).toBeTruthy();
    x.mounted.unmount();
    vi.spyOn(navigator, "vendor", "get").mockReturnValue(
      "Apple Computer, Inc.",
    );
    setup();
    fireEvent.keyDown(type("webkit"), { key: "Enter" });
    expect(document.querySelector(".message-listitem")).toBeTruthy();
    expect(document.querySelector(".message-virtualized")).toBeNull();
  });
  it("restores the original chat browser title when returning from another feature", () => {
    document.title = "Library · Access Denied";
    setup();
    expect(document.title).toBe("Access Denied");
  });
  it("starts no answer on StrictMode mount and submits a suggestion immediately", async () => {
    const x = setup();
    expect(x.requests).toEqual([]);
    fireEvent.click(
      screen.getByText("Summarize the key points").closest("button")!,
    );
    expect(x.requests).toEqual(["Summarize the key points of "]);
    await act(async () => x.finish());
    expect(x.saves).toEqual(["Summarize the key points of "]);
  });
  it("focuses the composer on global Escape before an opened dropdown restores focus", () => {
    setup();
    const input = type("question");
    fireEvent.keyDown(input, { key: "Enter" });
    const trigger = screen.getByLabelText("Chat actions");
    trigger.focus();
    fireEvent.click(trigger);
    expect(document.activeElement?.getAttribute("role")).toBe("menu");
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(document.activeElement).toBe(document.getElementById("chat-input"));
  });
  it("claims the latest draft once for same-tick native Enter and send clicks", () => {
    const x = setup();
    const input = type("first\n\nthird");
    const send = document.getElementById("send-message-button")!;
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
      send.click();
    });
    expect(x.requests).toEqual(["first\n  \nthird"]);
    expect(document.querySelector(".chat-queue")).toBeNull();
  });
  it("copies user text, saves user presentation locally, and copies active conversation with current edits", async () => {
    const clipboard = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: clipboard },
      configurable: true,
    });
    const x = setup();
    fireEvent.keyDown(type("original"), { key: "Enter" });
    await act(async () => x.finish());
    const user = document.querySelector(".user-message")! as HTMLElement;
    fireEvent.click(within(user).getByLabelText("Copy"));
    expect(clipboard).toHaveBeenLastCalledWith("original");
    fireEvent.click(within(user).getByLabelText("Edit"));
    fireEvent.change(screen.getByLabelText("Edit message"), {
      target: { value: "edited display" },
    });
    fireEvent.click(screen.getByText("Save", { exact: true }));
    expect(x.requests).toEqual(["original"]);
    expect(x.saves).toEqual(["original"]);
    fireEvent.click(screen.getByLabelText("Chat actions"));
    fireEvent.click(document.getElementById("chat-copy-button")!);
    expect(clipboard.mock.calls.at(-1)?.[0]).toContain(
      "### USER\nedited display\n\n### ASSISTANT",
    );
  });
  it("drops queued work on keyed New Chat remount while late answer still saves once", async () => {
    const x = setup();
    fireEvent.keyDown(type("old session"), { key: "Enter" });
    fireEvent.keyDown(type("discard queued"), { key: "Enter" });
    x.mounted.rerender(x.renderPage("new"));
    expect(screen.queryByText("old session")).toBeNull();
    await act(async () => x.finish());
    expect(x.requests).toEqual(["old session"]);
    expect(x.saves).toEqual(["old session"]);
    expect(screen.queryByTestId("assistant")).toBeNull();
    expect(screen.getByText("Suggested")).toBeTruthy();
  });
});
