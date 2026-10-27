// Native flyAndScale and slide formulas retained from the original UI transitions.
import type { ReactNode } from "react";
import {
  nativeFrames as sampledFrames,
  useNativeTransition,
  nativeSlideOptions,
} from "../../desktop-shell/react/nativeMotion";
export function animateEntrance(
  overlay: HTMLElement,
  panel: HTMLElement,
): () => void {
  if (!panel.animate) return () => {};
  const fade = overlay.animate([{ opacity: 0 }, { opacity: 1 }], {
    duration: 10,
  });
  const fly = panel.animate(
    sampledFrames(
      200,
      (t) => ({
        transform: `translate3d(0, ${-8 * (1 - t)}px, 0) scale(${0.95 + 0.05 * t})`,
        opacity: t,
      }),
      3,
    ),
    { duration: 200 },
  );
  return () => {
    fade.cancel();
    fly.cancel();
  };
}
export function Slide({
  open,
  children,
}: {
  open: boolean;
  children: ReactNode;
}) {
  const { present, ref } = useNativeTransition(open, nativeSlideOptions);
  return present ? (
    <div ref={ref} inert={!open} className="renderer-details-slide">
      {children}
    </div>
  ) : null;
}
