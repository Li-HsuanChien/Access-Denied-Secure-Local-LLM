import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useRef, useState } from "react";
import { NativeDropdown } from "./NativeDropdown";
let triggerRect: DOMRect;
function Fixture({
  align = "start",
  focusOnOpen = true,
}: {
  align?: "start" | "end";
  focusOnOpen?: boolean;
}) {
  const [open, setOpen] = useState(false),
    triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <input aria-label="Prior focus" />
      <button ref={triggerRef} onClick={() => setOpen(!open)}>
        Open
      </button>
      <NativeDropdown
        open={open}
        onOpenChange={setOpen}
        triggerRef={triggerRef}
        align={align}
        focusOnOpen={focusOnOpen}
        sideOffset={-2}
        className="test-menu"
      >
        <button>Item</button>
      </NativeDropdown>
    </>
  );
}
beforeEach(() => {
  vi.stubGlobal("innerWidth", 1440);
  vi.stubGlobal("innerHeight", 1000);
  triggerRect = {
    left: 489,
    top: 488.875,
    bottom: 516.875,
    right: 517,
    width: 28,
    height: 28,
    x: 489,
    y: 488.875,
    toJSON: () => ({}),
  };
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => triggerRect,
  );
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.getAttribute("role") === "menu" ? 198 : 28;
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.getAttribute("role") === "menu" ? 122 : 28;
    },
  );
});
it("leaves externally opened content unfocused and does not capture a previous focus target", () => {
  render(<Fixture focusOnOpen={false} />);
  const trigger = screen.getByText("Open");
  trigger.focus();
  fireEvent.click(trigger);
  expect(document.activeElement).toBe(trigger);
  const restore = vi.spyOn(trigger, "focus");
  screen.getByText("Item").focus();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(restore).not.toHaveBeenCalled();
  expect(screen.queryByRole("menu")).toBeNull();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("portals the undecorated native menu below the trigger and preserves shell focus through non-roving keys", () => {
  const { container } = render(<Fixture />);
  const previous = screen.getByRole("textbox");
  previous.focus();
  fireEvent.click(screen.getByText("Open"));
  const menu = screen.getByRole("menu");
  expect(menu.parentElement).toBe(document.body);
  expect(container.contains(menu)).toBe(false);
  expect(menu.style.top).toBe("514.875px");
  expect(menu.style.left).toBe("489px");
  expect(menu.style.padding).toBe("");
  expect(menu.style.borderRadius).toBe("");
  expect(document.activeElement).toBe(menu);
  for (const key of ["ArrowDown", "ArrowUp", "Home", "End"]) {
    fireEvent.keyDown(window, { key });
    expect(document.activeElement).toBe(menu);
  }
  fireEvent.keyDown(window, { key: "Escape" });
  expect(document.activeElement).toBe(previous);
  expect(screen.queryByRole("menu")).toBeNull();
});
it("flips above and clamps the menu within native narrow-viewport margins", () => {
  vi.stubGlobal("innerWidth", 390);
  vi.stubGlobal("innerHeight", 844);
  triggerRect = {
    ...triggerRect,
    left: 360,
    right: 388,
    top: 760,
    bottom: 788,
  };
  render(<Fixture />);
  fireEvent.click(screen.getByText("Open"));
  const menu = screen.getByRole("menu");
  expect(menu.style.top).toBe("auto");
  expect(menu.style.bottom).toBe("82px");
  expect(menu.style.left).toBe("176px");
});
it("keeps portal interaction open and closes on outside pointerdown without restoring focus", () => {
  render(<Fixture align="end" />);
  fireEvent.click(screen.getByText("Open"));
  const menu = screen.getByRole("menu");
  fireEvent.pointerDown(screen.getByText("Item"));
  expect(screen.getByRole("menu")).toBe(menu);
  expect(menu.style.right).toBe("923px");
  const outside = screen.getByRole("textbox");
  outside.focus();
  fireEvent.pointerDown(outside);
  expect(screen.queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(outside);
});

it("restores the native settled overflow so the menu shadow is not clipped", () => {
  const animations: {
    onfinish: (() => void) | null;
    cancel: ReturnType<typeof vi.fn>;
    currentTime: number;
  }[] = [];
  const descriptor = Object.getOwnPropertyDescriptor(
    Element.prototype,
    "animate",
  );
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    value: () => {
      const a = { onfinish: null, cancel: vi.fn(), currentTime: 0 };
      animations.push(a);
      return a;
    },
  });
  try {
    render(<Fixture />);
    fireEvent.click(screen.getByText("Open"));
    const menu = screen.getByRole("menu");
    expect(menu.style.overflowY).toBe("auto");
    act(() => animations[0].onfinish?.());
    act(() => animations[1].onfinish?.());
    expect(menu.style.overflowY).toBe("");
  } finally {
    if (descriptor)
      Object.defineProperty(Element.prototype, "animate", descriptor);
    else delete (Element.prototype as unknown as { animate?: unknown }).animate;
  }
});

it("deactivates a superseded intro finish until the reversing placeholder samples it", () => {
  const animations: {
    onfinish: (() => void) | null;
    cancel: ReturnType<typeof vi.fn>;
    currentTime: number;
    duration: number;
  }[] = [];
  const descriptor = Object.getOwnPropertyDescriptor(
    Element.prototype,
    "animate",
  );
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    value: (_frames: Keyframe[], options: KeyframeAnimationOptions) => {
      const a = {
        onfinish: null,
        cancel: vi.fn(),
        currentTime: 0,
        duration: Number(options.duration),
      };
      animations.push(a);
      return a;
    },
  });
  try {
    render(<Fixture />);
    fireEvent.click(screen.getByText("Open"));
    const menu = screen.getByRole("menu");
    act(() => animations[0].onfinish?.());
    const intro = animations[1];
    intro.currentTime = 200;
    fireEvent.keyDown(window, { key: "Escape" });
    act(() => intro.onfinish?.());
    expect(intro.cancel).not.toHaveBeenCalled();
    expect(menu.style.overflowY).toBe("auto");
    act(() => animations[2].onfinish?.());
    expect(intro.cancel).toHaveBeenCalledOnce();
    expect(animations[3].duration).toBe(200);
    act(() => animations[3].onfinish?.());
  } finally {
    if (descriptor)
      Object.defineProperty(Element.prototype, "animate", descriptor);
    else delete (Element.prototype as unknown as { animate?: unknown }).animate;
  }
});
