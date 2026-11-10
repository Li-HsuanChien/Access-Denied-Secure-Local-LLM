import { useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  autoUpdate,
  computePosition,
  flip,
  offset,
  shift,
} from "@floating-ui/dom";

/** A non-modal source preview: leaves the conversation in place. */
export function QuotePopover({
  anchor,
  label,
  onClose,
  children,
}: {
  anchor: HTMLElement | null;
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    let active = true;
    const previous =
      anchor ??
      (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null);
    const restore = () => {
      close.current();
      previous?.focus();
    };
    element.querySelector<HTMLButtonElement>("button")?.focus();
    const update = () => {
      if (!anchor) return;
      void computePosition(anchor, element, {
        strategy: "fixed",
        placement: "bottom-start",
        middleware: [offset(8), flip(), shift({ padding: 16 })],
      }).then(({ x, y }) => {
        if (active)
          Object.assign(element.style, { left: `${x}px`, top: `${y}px` });
      });
    };
    const stop = anchor ? autoUpdate(anchor, element, update) : () => {};
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        restore();
      }
    };
    const pointer = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !element.contains(event.target) &&
        !anchor?.contains(event.target)
      )
        close.current();
    };
    window.addEventListener("keydown", key);
    document.addEventListener("pointerdown", pointer, true);
    return () => {
      active = false;
      stop();
      window.removeEventListener("keydown", key);
      document.removeEventListener("pointerdown", pointer, true);
    };
  }, [anchor]);
  return createPortal(
    <div
      ref={root}
      role="dialog"
      aria-label={label}
      className="source-quote-popover"
    >
      {children}
    </div>,
    document.body,
  );
}
