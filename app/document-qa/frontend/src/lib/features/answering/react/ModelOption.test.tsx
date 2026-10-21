import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  PinnedModelProvider,
  usePinnedModel,
} from "../../desktop-shell/react/PinnedModel";
import { ModelOption } from "./ModelOption";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function PinState() {
  const { pinned } = usePinnedModel();
  return <output>{pinned ? "pinned" : "unpinned"}</output>;
}
it("retains the More Options trigger focus when the submenu opens from a pointer click", () => {
  render(
    <PinnedModelProvider>
      <ModelOption onSelect={() => {}} />
    </PinnedModelProvider>,
  );
  const trigger = screen.getByLabelText("More Options", { selector: "button" });
  trigger.focus();
  fireEvent.click(trigger);
  expect(document.activeElement).toBe(trigger);
});
it.each(["Enter", " "])(
  "focuses the submenu when More Options opens with %s",
  (key) => {
    const select = vi.fn();
    render(
      <PinnedModelProvider>
        <ModelOption onSelect={select} />
      </PinnedModelProvider>,
    );
    const trigger = screen.getByLabelText("More Options", {
      selector: "button",
    });
    trigger.focus();
    fireEvent.keyDown(trigger, { key });
    expect(document.activeElement).toBe(screen.getByRole("menu"));
    expect(select).not.toHaveBeenCalled();
  },
);
it("toggles app-lifetime sidebar state through the original More Options controls", () => {
  const select = vi.fn();
  render(
    <PinnedModelProvider>
      <ModelOption onSelect={select} />
      <PinState />
    </PinnedModelProvider>,
  );
  fireEvent.click(
    screen.getByLabelText("More Options", { selector: "button" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Keep in Sidebar" }));
  expect(screen.getByText("pinned")).toBeTruthy();
  fireEvent.click(
    screen.getByLabelText("More Options", { selector: "button" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Hide from Sidebar" }));
  expect(screen.getByText("unpinned")).toBeTruthy();
  expect(select).not.toHaveBeenCalled();
});
it("copies the exact local model URL without selecting the model or adding a notice", () => {
  const select = vi.fn(),
    copy = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: copy },
    configurable: true,
  });
  render(
    <PinnedModelProvider>
      <ModelOption onSelect={select} />
    </PinnedModelProvider>,
  );
  fireEvent.click(
    screen.getByLabelText("More Options", { selector: "button" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Copy Link" }));
  expect(copy).toHaveBeenCalledWith(
    `${window.location.origin}/?model=secure-qa-local`,
  );
  expect(select).not.toHaveBeenCalled();
  expect(screen.queryByRole("alert")).toBeNull();
});
