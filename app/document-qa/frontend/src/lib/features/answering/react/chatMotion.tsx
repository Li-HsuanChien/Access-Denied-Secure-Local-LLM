import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  autoUpdate,
  computePosition,
  flip,
  offset,
  shift,
  size,
} from "@floating-ui/dom";

/** Native Chat.svelte loading boundary, whose fade runs on mount and New Chat remount. */
export function ChatEntrance({ children }: { children: ReactNode }) {
  const node = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!node.current?.animate) return;
    const animation = node.current.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 50,
      fill: "forwards",
    });
    let active = true;
    animation.finished
      .then(() => {
        if (active) animation.cancel();
      })
      .catch(() => {});
    return () => {
      active = false;
      animation.cancel();
    };
  }, []);
  return (
    <div ref={node} className="w-full h-full flex flex-col">
      {children}
    </div>
  );
}

type FlyRun = {
  value: () => number;
  deactivate: () => void;
  cancel: () => void;
};
const cubicOut = (t: number) => 1 - (1 - t) ** 3;
const flyFrame = (t: number): Keyframe => ({
  opacity: t,
  transform: `translate3d(0, ${-8 * (1 - t)}px, 0) scale(${0.95 + 0.05 * t})`,
});
/** Native bidirectional transition: keep the counterpart running until the zero-duration
 * hold finishes, then sample its current pose and scale the remaining duration. */
function startFly(
  element: HTMLElement,
  target: number,
  previous: FlyRun | undefined,
  finish: () => void,
): FlyRun {
  previous?.deactivate();
  let active = true;
  let value = () => 1 - target;
  let animation = element.animate(
    target === 1 && !previous ? [flyFrame(0), flyFrame(0)] : [],
    { duration: 0, fill: "forwards" },
  );
  animation.onfinish = () => {
    animation.cancel();
    const start = previous?.value() ?? 1 - target;
    previous?.cancel();
    const delta = target - start;
    const duration = 200 * Math.abs(delta);
    const steps = Math.ceil(duration / (1000 / 60));
    const frames =
      duration > 0
        ? Array.from({ length: steps + 1 }, (_, index) =>
            flyFrame(start + delta * cubicOut(index / steps)),
          )
        : [];
    animation = element.animate(frames, { duration, fill: "forwards" });
    value = () =>
      start +
      delta *
        cubicOut(
          Math.max(
            0,
            Math.min(1, Number(animation.currentTime ?? 0) / (duration || 1)),
          ),
        );
    animation.onfinish = () => {
      value = () => target;
      if (active) finish();
    };
  };
  return {
    value: () => value(),
    deactivate: () => {
      active = false;
    },
    cancel: () => {
      active = false;
      animation.onfinish = null;
      animation.cancel();
      animation.effect = null;
      previous?.cancel();
    },
  };
}
export function FlyMenu({
  open,
  className,
  style,
  onClose,
  children,
}: {
  open: boolean;
  className: string;
  style?: CSSProperties;
  onClose?: () => void;
  children: ReactNode;
}) {
  const [present, setPresent] = useState(open);
  const node = useRef<HTMLDivElement>(null);
  const current = useRef<FlyRun | undefined>(undefined);
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    if (open) setPresent(true);
  }, [open]);
  useLayoutEffect(() => {
    const element = node.current;
    if (!element) return;
    element.inert = !open;
    if (!element.animate) {
      if (!open) setPresent(false);
      return;
    }
    const run = startFly(element, open ? 1 : 0, current.current, () => {
      run.cancel();
      if (!open) {
        current.current = undefined;
        setPresent(false);
      }
    });
    current.current = run;
    return () => run.deactivate();
  }, [open, present]);
  useEffect(
    () => () => {
      current.current?.cancel();
      current.current = undefined;
    },
    [],
  );
  useEffect(() => {
    if (!open) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close.current?.();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [open]);
  return present ? (
    <div ref={node} className={className} style={style}>
      {children}
    </div>
  ) : null;
}
export function ModelMenu({
  open,
  triggerRef,
  onClose,
  children,
}: {
  open: boolean;
  triggerRef: RefObject<HTMLElement | null>;
  onClose: (restoreComposer?: boolean) => void;
  children: ReactNode;
}) {
  const portal = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const root = portal.current,
      trigger = triggerRef.current;
    if (!root || !trigger || !open) return;
    let active = true;
    const cleanup = autoUpdate(trigger, root, () => {
      const panel = root.firstElementChild as HTMLElement | null;
      if (!panel) return;
      panel.style.maxHeight = "";
      void computePosition(trigger, root, {
        strategy: "fixed",
        placement: "bottom-end",
        middleware: [
          offset(2),
          flip({ padding: 8, crossAxis: false }),
          shift({ padding: 8 }),
          size({
            padding: 8,
            apply({ availableHeight, availableWidth }) {
              panel.style.maxHeight = `${Math.max(0, availableHeight)}px`;
              panel.style.maxWidth = `${Math.max(0, availableWidth)}px`;
            },
          }),
        ],
      }).then(({ x, y }) => {
        if (active) {
          root.style.left = `${x}px`;
          root.style.top = `${y}px`;
        }
      });
    });
    return () => {
      active = false;
      cleanup();
    };
  }, [open, triggerRef]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (
        triggerRef.current?.contains(target) ||
        portal.current?.contains(target) ||
        target.closest?.(".model-selector-child-menu")
      )
        return;
      close.current(false);
    };
    document.addEventListener("pointerdown", outside);
    // Same desktop-only search focus retries as original Selector.svelte.
    const timers =
      window.innerWidth >= 768
        ? [0, 50, 150].map((delay) =>
            window.setTimeout(
              () =>
                portal.current
                  ?.querySelector<HTMLInputElement>("#model-search-input")
                  ?.focus(),
              delay,
            ),
          )
        : [];
    return () => {
      document.removeEventListener("pointerdown", outside);
      timers.forEach(window.clearTimeout);
    };
  }, [open, triggerRef]);
  return createPortal(
    <div
      ref={portal}
      className="chat-react chat-model-portal"
      style={{
        position: "fixed",
        zIndex: 9999,
        top: 0,
        left: 0,
        width: "max-content",
      }}
    >
      <FlyMenu
        open={open}
        onClose={() => close.current(true)}
        className="chat-model-menu"
      >
        {children}
      </FlyMenu>
    </div>,
    document.body,
  );
}
