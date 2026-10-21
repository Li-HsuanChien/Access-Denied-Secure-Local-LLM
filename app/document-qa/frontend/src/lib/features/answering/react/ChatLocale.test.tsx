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
it("translates original Chat/model/drawer keys with interpolation and English fallback while preserving product prompts", async () => {
  const x = mount();
  expect(screen.getAllByText("conversation temporaire").length).toBeGreaterThan(
    0,
  );
  expect(screen.getByText("Suggéré")).toBeTruthy();
  expect(screen.getByText("Summarize the key points")).toBeTruthy();
  fireEvent.click(
    screen.getByLabelText("Modèle sélectionné : Document Assistant"),
  );
  expect(screen.getByLabelText("Rechercher dans les modèles")).toBeTruthy();
  expect(
    screen.getByLabelText("Sélectionner le modèle Document Assistant"),
  ).toBeTruthy();
  expect(screen.getByText("Définir comme valeur par défaut")).toBeTruthy();
  expect(screen.getByLabelText("Compare")).toBeTruthy(); // Original empty French value falls back.
  x.type("/status");
  fireEvent.keyDown(x.input, { key: "Enter" });
  expect(screen.getByText("Context usage")).toBeTruthy();
  x.type("first\nsecond\nthird");
  fireEvent.click(screen.getByLabelText("Expand input"));
  expect(screen.getByRole("dialog", { name: "Entrée" })).toBeTruthy();
  expect(
    screen.getByRole("textbox", { name: "Entrez votre message ici..." }),
  ).toBeTruthy();
  fireEvent.keyDown(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Fermer" }),
    {
      key: "Escape",
    },
  );
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("translates active Chat and transient user edit actions without translating user content", async () => {
  const x = mount();
  await act(async () => {
    x.type("English question");
    fireEvent.keyDown(x.input, { key: "Enter" });
  });
  expect(screen.getByText("Nouvelle conversation")).toBeTruthy();
  expect(screen.getByText("Conversation par chat")).toBeTruthy();
  const user = document.querySelector(".user-message")! as HTMLElement;
  expect(within(user).getByText("English question")).toBeTruthy();
  expect(within(user).getByLabelText("Copier")).toBeTruthy();
  fireEvent.click(within(user).getByLabelText("Modifier"));
  expect(screen.getByText("Enregistrer")).toBeTruthy();
  expect(screen.getByText("Annuler")).toBeTruthy();
  expect(screen.getByText("Envoyer")).toBeTruthy();
});
