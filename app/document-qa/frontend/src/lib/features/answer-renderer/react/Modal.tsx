import { useEffect, useRef, type ReactNode } from "react";
import { animateEntrance } from "./motion";
import { createPortal } from "react-dom";
export function Modal({
  label,
  onClose,
  children,
  confirm = false,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
  confirm?: boolean;
}) {
  const overlay = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null),
    close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null,
      overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focus = () =>
      root.current
        ?.querySelector<HTMLElement>('button,input,textarea,[tabindex="0"]')
        ?.focus();
    focus();
    const stopAnimation =
      root.current && overlay.current
        ? animateEntrance(overlay.current, root.current)
        : () => {};
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close.current();
      }
      if (event.key === "Tab") {
        const items = [
          ...(root.current?.querySelectorAll<HTMLElement>(
            'button,input,textarea,a[href],[tabindex="0"]',
          ) ?? []),
        ].filter((node) => !node.hasAttribute("disabled"));
        if (!items.length) {
          event.preventDefault();
          return;
        }
        const first = items[0],
          last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      stopAnimation();
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, []);
  return createPortal(
    <div
      ref={overlay}
      className="renderer-modal modal fixed inset-0 bg-black/45 dark:bg-black/60 w-full h-screen max-h-[100dvh] p-3 flex justify-center z-9999 overflow-y-auto overscroll-contain"
      style={{ scrollbarGutter: "stable" }}
      onMouseDown={() => close.current()}
    >
      <div
        ref={root}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={
          confirm
            ? "m-auto max-w-full w-[32rem] mx-2 bg-white dark:bg-gray-950 rounded-3xl max-h-[100dvh] shadow-3xl border border-white dark:border-gray-900"
            : "m-auto max-w-full w-[56rem] mx-2 shadow-3xl min-h-fit scrollbar-hidden bg-white dark:bg-gray-900 rounded-4xl border border-white dark:border-gray-850"
        }
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
