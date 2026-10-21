import { afterEach, describe, expect, it, vi } from "vitest";
import { copyToClipboard } from "./clipboard";
afterEach(() => {
  vi.restoreAllMocks();
});
describe("local chat clipboard", () => {
  it("copies plain text through the fallback selection when Clipboard API is unavailable", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
    let copied = "";
    Object.defineProperty(document, "execCommand", {
      value: (command: string) => {
        if (command === "copy")
          copied = window.getSelection()?.toString() ?? "";
        return true;
      },
      configurable: true,
    });
    expect(await copyToClipboard("question\nanswer")).toBe(true);
    expect(copied).toBe("question\nanswer");
    expect(document.querySelector("[data-chat-clipboard]")).toBeNull();
  });
  it("reports denied clipboard writes without an uncaught rejection", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async () => {
          throw new Error("denied");
        },
      },
      configurable: true,
    });
    expect(await copyToClipboard("question")).toBe(false);
  });
});
