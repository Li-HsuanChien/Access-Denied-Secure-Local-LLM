import { afterEach, beforeAll, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { initReactI18n } from "@/react/i18n";
import { AppProviders, createAppRuntime } from "@/react/providers";
import type {
  AppServices,
  ChatAnswerProps,
  AssistantMessageViewProps,
} from "../../react-contracts";
import { ChatPage } from "./ChatPage";
vi.mock("../../answer-renderer/react/ChatAnswer", () => ({
  ChatAnswer: ({ content }: ChatAnswerProps) => <div>{content}</div>,
}));
vi.mock("../../answer-renderer/react/AssistantMessageView", () => ({
  AssistantMessageView: ({ message }: AssistantMessageViewProps) => (
    <div>{message.content}</div>
  ),
}));
beforeAll(async () => {
  window.history.replaceState(null, "", "/qa?lang=fr-FR");
  await initReactI18n();
});
afterEach(cleanup);
function mount() {
  let n = 0;
  const runtime = createAppRuntime({
    createId: () => String(++n),
    now: () => 0,
    answering: { ask: async () => new Promise(() => {}) },
    settings: { read: async () => ({ general_knowledge: true }) },
  } as unknown as AppServices);
  render(
    <AppProviders runtime={runtime}>
      <ChatPage />
    </AppProviders>,
  );
  const input = screen.getByLabelText("Ask a question about your library…");
  function type(value: string) {
    input.textContent = value;
    fireEvent.input(input);
  }
  return { input, type };
}
it("keeps product prompts and reading-room copy in English while translated chrome falls back cleanly", async () => {
  const x = mount();
  // Product copy is English-only; the composer, greeting and starters are not translated.
  expect(screen.getByRole("heading", { name: "What would you like to find out?" })).toBeTruthy();
  expect(screen.getByText("Summarize the key points")).toBeTruthy();
  expect(x.input.getAttribute("aria-label")).toBe("Ask a question about your library…");
  // The parity model picker, slash commands and expanded drawer were removed by the redesign.
  expect(screen.queryByLabelText("Modèle sélectionné : Document Assistant")).toBeNull();
  expect(screen.queryByLabelText("Expand input")).toBeNull();
});
it("translates active Chat and transient user edit actions without translating user content", async () => {
  const x = mount();
  await act(async () => {
    x.type("English question");
    fireEvent.keyDown(x.input, { key: "Enter" });
  });
  expect(screen.getByText("Conversation par chat")).toBeTruthy();
  const user = document.querySelector(".user-message")! as HTMLElement;
  expect(within(user).getByText("English question")).toBeTruthy();
  expect(within(user).getByLabelText("Copier")).toBeTruthy();
  fireEvent.click(within(user).getByLabelText("Modifier"));
  expect(screen.getByText("Enregistrer")).toBeTruthy();
  expect(screen.getByText("Annuler")).toBeTruthy();
  expect(screen.getByText("Envoyer")).toBeTruthy();
});
