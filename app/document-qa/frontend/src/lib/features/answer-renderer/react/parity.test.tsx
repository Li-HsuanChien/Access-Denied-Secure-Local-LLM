import { AssistantMessageView } from "./AssistantMessageView";
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { MarkdownContent } from "./ChatAnswer";
import { Modal } from "./Modal";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const props = {
  onNavigate: vi.fn(),
  onSaveContent: vi.fn(),
  onPreview: vi.fn(),
};
it("retains each original alert palette and distinct SVG icon", () => {
  const { container } = render(
    <MarkdownContent
      {...props}
      content={["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"]
        .map((type) => `> [!${type}]\n> Text`)
        .join("\n\n")}
    />,
  );
  const palettes = ["sky", "emerald", "purple", "yellow", "rose"];
  const alerts = [...container.querySelectorAll(".renderer-alert")];
  expect(alerts).toHaveLength(5);
  alerts.forEach((node, index) => {
    expect(node.classList.contains(`border-${palettes[index]}-500`)).toBe(true);
    expect(
      node.firstElementChild?.classList.contains(`text-${palettes[index]}-500`),
    ).toBe(true);
  });
  expect(
    new Set(alerts.map((node) => node.querySelector("path")?.getAttribute("d")))
      .size,
  ).toBe(5);
});
it("animates modal entrance with original 10ms fade and 200ms fly/scale", () => {
  const animate = vi.fn(() => ({ cancel: vi.fn() }));
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    value: animate,
  });
  render(
    <Modal label="Source" onClose={vi.fn()}>
      <button>Close</button>
    </Modal>,
  );
  expect(
    animate.mock.calls.map(
      (call) =>
        (call as unknown as [Keyframe[], KeyframeAnimationOptions])[1].duration,
    ),
  ).toEqual([10, 200]);
});
it("reverses details from its current height with proportional duration and inert outro", () => {
  const animations: {
    currentTime: number;
    onfinish: (() => void) | null;
    cancel: ReturnType<typeof vi.fn>;
    frames: Keyframe[];
    duration: number;
  }[] = [];
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    value: (frames: Keyframe[], options: KeyframeAnimationOptions) => {
      const animation = {
        currentTime: 0,
        onfinish: null,
        cancel: vi.fn(),
        frames,
        duration: options.duration as number,
      };
      animations.push(animation);
      return animation;
    },
  });
  const css = document.createElement("style");
  css.textContent = ".renderer-details-slide { height:40px; }";
  document.head.append(css);
  try {
    render(
      <MarkdownContent
        {...props}
        content={"<details>\n<summary>More</summary>\nDetail body\n</details>"}
      />,
    );
    const trigger = screen.getByRole("button", { name: "More" });
    fireEvent.click(trigger);
    expect(animations[0].duration).toBe(0);
    act(() => animations[0].onfinish?.());
    expect(animations[1].duration).toBe(300);
    animations[1].currentTime = 60;
    const body = screen.getByText("Detail body"),
      slide = body.closest(".renderer-details-slide")!;
    fireEvent.click(trigger);
    expect(slide.hasAttribute("inert")).toBe(true);
    act(() => animations[2].onfinish?.());
    expect(animations[3].duration).toBeCloseTo(201.696);
    expect(parseFloat(animations[3].frames[0].height as string)).toBeCloseTo(
      26.8928,
    );
    animations[3].currentTime = 100.848;
    fireEvent.click(trigger);
    act(() => animations[4].onfinish?.());
    expect(animations[5].duration).toBeCloseTo(293.697);
    expect(parseFloat(animations[5].frames[0].height as string)).toBeCloseTo(
      0.8404,
    );
    expect(slide.hasAttribute("inert")).toBe(false);
    expect(screen.getByText("Detail body")).toBe(body);
    act(() => animations[5].onfinish?.());
    fireEvent.click(trigger);
    act(() => animations[6].onfinish?.());
    expect(animations[7].duration).toBe(300);
    expect(screen.getByText("Detail body")).toBeTruthy();
    act(() => animations[7].onfinish?.());
    expect(screen.queryByText("Detail body")).toBeNull();
  } finally {
    css.remove();
  }
});

it("reverses regeneration menu motion from the current pose and retains it through the outro", () => {
  const animations: {
    currentTime: number;
    onfinish: (() => void) | null;
    cancel: ReturnType<typeof vi.fn>;
    frames: Keyframe[];
    duration: number;
  }[] = [];
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    value: (frames: Keyframe[], options: KeyframeAnimationOptions) => {
      const animation = {
        currentTime: 0,
        onfinish: null,
        cancel: vi.fn(),
        frames,
        duration: options.duration as number,
      };
      animations.push(animation);
      return animation;
    },
  });
  render(
    <AssistantMessageView
      message={{
        id: "a",
        parentId: "q",
        childIds: [],
        createdAt: 1792504800000,
        content: "Answer",
        role: "assistant",
        status: "complete",
        answer: null,
        historyWarning: null,
        error: null,
      }}
      branch={{ index: 1, count: 1 }}
      onNavigate={vi.fn()}
      onCopy={vi.fn(async () => {})}
      onSelectBranch={vi.fn()}
      onSaveEdit={vi.fn()}
      onRegenerate={vi.fn()}
      onDelete={vi.fn()}
      canRegenerate
      canDelete={false}
    />,
  );
  const trigger = screen.getByRole("button", { name: "Regenerate" });
  fireEvent.click(trigger);
  expect(animations).toHaveLength(1);
  act(() => animations[0].onfinish?.());
  const entrance = animations[1];
  expect(entrance.duration).toBe(200);
  entrance.currentTime = 40;
  const input = screen.getByPlaceholderText("Suggest a change");
  fireEvent.keyDown(window, { key: "Escape" });
  expect(
    input.closest(".renderer-regenerate-menu")?.hasAttribute("inert"),
  ).toBe(true);
  act(() => animations[2].onfinish?.());
  const interrupted = animations[3];
  expect(interrupted.duration).toBeCloseTo(97.6);
  expect(Number(interrupted.frames[0].opacity)).toBeCloseTo(0.488);
  expect(Number(interrupted.frames.at(-1)?.opacity)).toBe(0);
  interrupted.currentTime = 48.8;
  fireEvent.click(trigger);
  act(() => animations[4].onfinish?.());
  const reversed = animations[5];
  expect(reversed.duration).toBeCloseTo(187.8);
  expect(Number(reversed.frames[0].opacity)).toBeCloseTo(0.061);
  expect(screen.getByPlaceholderText("Suggest a change")).toBe(input);
  act(() => reversed.onfinish?.());
  fireEvent.keyDown(window, { key: "Escape" });
  act(() => animations[6].onfinish?.());
  expect(animations[7].duration).toBe(200);
  expect(Number(animations[7].frames[0].opacity)).toBe(1);
  expect(screen.getByPlaceholderText("Suggest a change")).toBeTruthy();
  act(() => animations[7].onfinish?.());
  expect(screen.queryByPlaceholderText("Suggest a change")).toBeNull();
});

it("uses the native portal menu shell and restores the previously focused control on Escape", () => {
  const { container } = render(
    <>
      <input aria-label="Prior focus" />
      <AssistantMessageView
        message={{
          id: "a",
          parentId: "q",
          childIds: [],
          createdAt: 1792504800000,
          content: "Answer",
          role: "assistant",
          status: "complete",
          answer: null,
          historyWarning: null,
          error: null,
        }}
        branch={{ index: 1, count: 1 }}
        onNavigate={vi.fn()}
        onCopy={vi.fn(async () => {})}
        onSelectBranch={vi.fn()}
        onSaveEdit={vi.fn()}
        onRegenerate={vi.fn()}
        onDelete={vi.fn()}
        canRegenerate
        canDelete={false}
      />
    </>,
  );
  const previous = screen.getByRole("textbox", { name: "Prior focus" });
  previous.focus();
  fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
  const menu = screen.getByRole("menu");
  expect(menu.parentElement).toBe(document.body);
  expect(container.contains(menu)).toBe(false);
  expect(document.activeElement).toBe(menu);
  for (const key of ["ArrowDown", "ArrowUp", "Home", "End"]) {
    fireEvent.keyDown(window, { key });
    expect(document.activeElement).toBe(menu);
  }
  fireEvent.pointerDown(screen.getByPlaceholderText("Suggest a change"));
  expect(menu.hasAttribute("inert")).toBe(false);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(document.activeElement).toBe(previous);
});
