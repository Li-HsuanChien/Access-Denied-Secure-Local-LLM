import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { initReactI18n } from "@/react/i18n";
import { SourcePanel } from "./SourcePanel";
import { createFixtureAnsweringClient } from "../../answering/fixtureAnsweringClient";
afterEach(cleanup);
it("uses the original translated source control keys and interpolation", async () => {
  localStorage.setItem("locale", "de-DE");
  await initReactI18n();
  const answer = await createFixtureAnsweringClient({ delay: 0 }).ask(
    "source",
    true,
  );
  const expanded = vi.fn();
  render(
    <SourcePanel
      citations={answer.citations}
      expanded={false}
      onExpandedChange={expanded}
    />,
  );
  expect(screen.getByText("1 Quelle")).toBeTruthy();
  fireEvent.click(screen.getByRole("button"));
  expect(expanded).toHaveBeenCalledWith(true);
});
