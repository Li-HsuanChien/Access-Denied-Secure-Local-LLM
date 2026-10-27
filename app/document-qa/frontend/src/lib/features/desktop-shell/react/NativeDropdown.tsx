// Manual default-viewport Dropdown behavior retained from common/Dropdown.svelte.
import {
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { nativeFlyAndScale, useNativeTransition } from "./nativeMotion";
export interface NativeDropdownProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef: RefObject<HTMLElement | null>;
  className?: string;
  children: ReactNode;
  side?: "top" | "bottom";
  align?: "start" | "end";
  sideOffset?: number;
  maxHeight?: string;
  focusOnOpen?: boolean;
}
export function NativeDropdown({
  open,
  onOpenChange,
  triggerRef,
  className = "",
  children,
  side = "bottom",
  align = "start",
  sideOffset = 4,
  maxHeight = "min(32rem, calc(100dvh - 2rem))",
  focusOnOpen = true,
}: NativeDropdownProps) {
  const { present, ref } = useNativeTransition(open, nativeFlyAndScale);
  const previousFocus = useRef<HTMLElement | null>(null),
    wasOpen = useRef(false);
  const state = useRef({ open, onOpenChange });
  state.current = { open, onOpenChange };
  useLayoutEffect(() => {
    if (open && !wasOpen.current)
      previousFocus.current =
        focusOnOpen && document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    wasOpen.current = open;
  }, [open, focusOnOpen]);
  useLayoutEffect(() => {
    if (!present) return;
    const element = ref.current,
      trigger = triggerRef.current;
    if (!element || !trigger) return;
    const position = () => {
      const rect = trigger.getBoundingClientRect(),
        height = Math.max(element.scrollHeight || 0, element.offsetHeight || 0);
      const below = innerHeight - rect.bottom - sideOffset,
        above = rect.top - sideOffset;
      let openAbove = side === "top";
      if (side === "bottom" && below < height && above > below)
        openAbove = true;
      else if (side === "top" && above < height && below > above)
        openAbove = false;
      element.style.position = "fixed";
      element.style.zIndex = "9999";
      element.style.top = openAbove ? "auto" : `${rect.bottom + sideOffset}px`;
      element.style.bottom = openAbove
        ? `${innerHeight - rect.top + sideOffset}px`
        : "auto";
      const width = element.offsetWidth || 0;
      if (align === "end") {
        let right = innerWidth - rect.right;
        if (right + width > innerWidth) right = innerWidth - width - 16;
        element.style.right = `${Math.max(16, right)}px`;
        element.style.left = "auto";
      } else {
        let left = rect.left;
        if (left + width + 16 > innerWidth) left = innerWidth - width - 16;
        element.style.left = `${Math.max(16, left)}px`;
        element.style.right = "auto";
      }
    };
    let frame: number | undefined,
      lastHeight = 0;
    const schedule = () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = undefined;
        position();
      });
    };
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            if (element.scrollHeight !== lastHeight) {
              lastHeight = element.scrollHeight;
              schedule();
            }
          });
    observer?.observe(element);
    position();
    const timer = window.setTimeout(position, 50);
    window.addEventListener("scroll", position, true);
    window.addEventListener("resize", position);
    return () => {
      observer?.disconnect();
      clearTimeout(timer);
      if (frame !== undefined) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", position, true);
      window.removeEventListener("resize", position);
    };
  }, [present, triggerRef, side, align, sideOffset]);
  useLayoutEffect(() => {
    if (open && present && focusOnOpen) ref.current?.focus();
  }, [open, present, focusOnOpen]);
  useEffect(() => {
    const close = (restore: boolean) => {
      if (!state.current.open) return;
      state.current.open = false;
      state.current.onOpenChange(false);
      if (restore && previousFocus.current?.isConnected)
        previousFocus.current.focus();
      previousFocus.current = null;
    };
    const pointer = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !triggerRef.current?.contains(event.target) &&
        !ref.current?.contains(event.target)
      )
        close(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape")
        close(!!ref.current?.contains(document.activeElement));
    };
    document.addEventListener("pointerdown", pointer, true);
    window.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", pointer, true);
      window.removeEventListener("keydown", key);
    };
  }, [triggerRef]);
  return present
    ? createPortal(
        <div
          ref={ref}
          role="menu"
          tabIndex={-1}
          inert={!open}
          className={className}
          style={{ maxHeight, overflowY: "auto" }}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {children}
        </div>,
        document.body,
      )
    : null;
}
