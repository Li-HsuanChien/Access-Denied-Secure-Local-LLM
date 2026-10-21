import { cleanup, render, act, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatEntrance, FlyMenu } from "./chatMotion";

beforeEach(() => {
  HTMLElement.prototype.animate = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function mockAnimations() {
  const animations: {
    duration: number;
    currentTime: number;
    onfinish: (() => void) | null;
    finish: () => void;
    cancel: ReturnType<typeof vi.fn>;
    finished: Promise<void>;
  }[] = [];
  const animate = vi
    .spyOn(HTMLElement.prototype, "animate")
    .mockImplementation((_frames, options) => {
      let resolve!: () => void;
      const finished = new Promise<void>((r) => {
        resolve = r;
      });
      const duration =
        typeof options === "number" ? options : Number(options?.duration ?? 0);
      const animation = {
        duration,
        currentTime: 0,
        onfinish: null as (() => void) | null,
        cancel: vi.fn(),
        effect: null,
        finished,
        finish() {
          this.currentTime = duration;
          this.onfinish?.();
          resolve();
        },
      };
      animations.push(animation);
      return animation as unknown as Animation;
    });
  return { animations, animate };
}
it("keeps the original inner Chat wrapper and native 50ms fade, then removes its finished effect", async () => {
  const { animations, animate } = mockAnimations();
  const result = render(
    <ChatEntrance>
      <span>Chat</span>
    </ChatEntrance>,
  );
  expect(result.container.firstElementChild?.className).toBe(
    "w-full h-full flex flex-col",
  );
  expect(animate).toHaveBeenCalledWith([{ opacity: 0 }, { opacity: 1 }], {
    duration: 50,
    fill: "forwards",
  });
  await act(async () => animations[0].finish());
  expect(animations[0].cancel).toHaveBeenCalled();
});
it("keeps the model menu inert during its original settled 200ms outgoing fly and scale", () => {
  const { animations, animate } = mockAnimations();
  const result = render(
    <FlyMenu open className="chat-model-menu">
      <span>Model</span>
    </FlyMenu>,
  );
  expect(animations[0].duration).toBe(0);
  act(() => animations[0].finish());
  expect(animate).toHaveBeenLastCalledWith(
    expect.arrayContaining([
      expect.objectContaining({
        transform: "translate3d(0, -8px, 0) scale(0.95)",
        opacity: 0,
      }),
      expect.objectContaining({
        transform: "translate3d(0, 0px, 0) scale(1)",
        opacity: 1,
      }),
    ]),
    { duration: 200, fill: "forwards" },
  );
  act(() => animations[1].finish());
  result.rerender(
    <FlyMenu open={false} className="chat-model-menu">
      <span>Model</span>
    </FlyMenu>,
  );
  expect((result.container.firstElementChild as HTMLElement).inert).toBe(true);
  act(() => animations[2].finish());
  expect(animations[3].duration).toBe(200);
  expect(result.container.querySelector(".chat-model-menu")).toBeTruthy();
  act(() => animations[3].finish());
  expect(result.container.querySelector(".chat-model-menu")).toBeNull();
});
it("samples a running counterpart after the native hold and reverses from its pose with proportional duration", () => {
  const { animations, animate } = mockAnimations();
  const result = render(
    <FlyMenu open className="chat-actions-menu">
      <span>Copy</span>
    </FlyMenu>,
  );
  act(() => animations[0].finish());
  animations[1].currentTime = 50;
  result.rerender(
    <FlyMenu open={false} className="chat-actions-menu">
      <span>Copy</span>
    </FlyMenu>,
  );
  expect(animations[1].cancel).not.toHaveBeenCalled();
  animations[1].currentTime = 100; // Original counterpart continues until the next native hold finishes.
  act(() => animations[2].finish());
  const frames = animate.mock.calls.at(-1)![0] as Keyframe[];
  expect(frames[0].opacity).toBe(0.875);
  expect(frames[0].transform).toBe(
    "translate3d(0, -1px, 0) scale(0.9937499999999999)",
  );
  expect(animations[3].duration).toBe(175);
  expect(animations[1].cancel).toHaveBeenCalled();
});
it("closes an open Chat actions menu on global Escape and removes the handler on close", () => {
  const close = vi.fn();
  mockAnimations();
  const result = render(
    <FlyMenu open onClose={close} className="chat-actions-menu">
      Copy
    </FlyMenu>,
  );
  fireEvent.keyDown(window, { key: "Escape" });
  expect(close).toHaveBeenCalledTimes(1);
  result.rerender(
    <FlyMenu open={false} onClose={close} className="chat-actions-menu">
      Copy
    </FlyMenu>,
  );
  fireEvent.keyDown(window, { key: "Escape" });
  expect(close).toHaveBeenCalledTimes(1);
});
