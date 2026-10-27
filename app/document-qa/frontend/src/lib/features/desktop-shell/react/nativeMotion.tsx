// Native Svelte transition formulas/interrupt semantics retained for React presentation.
import { useLayoutEffect, useRef, useState } from "react";
export type NativeMotionOptions = {
  duration: number;
  power: number;
  pose: (progress: number) => Keyframe;
};
export function nativeFrames(
  duration: number,
  css: (t: number) => Keyframe,
  power: number,
): Keyframe[] {
  const steps = Math.ceil(duration / (1000 / 60));
  return Array.from({ length: steps + 1 }, (_, index) => {
    const progress = index / steps;
    return { ...css(1 - (1 - progress) ** power), offset: progress };
  });
}
export function nativeFlyAndScale(element: HTMLElement): NativeMotionOptions {
  const transform = getComputedStyle(element).transform;
  const base = transform === "none" ? "" : transform;
  return {
    duration: 200,
    power: 3,
    pose: (t) => ({
      transform: `${base} translate3d(0, ${-8 * (1 - t)}px, 0) scale(${0.95 + 0.05 * t})`,
      opacity: t,
    }),
  };
}
/** A reversal samples the counterpart's eased currentTime before cancelling it. */
export function createNativeTransition(
  element: HTMLElement,
  options: () => NativeMotionOptions,
) {
  type Flight = {
    progress: () => number;
    abort: () => void;
    finish: () => void;
  };
  let current: Flight | null = null,
    configuration: NativeMotionOptions | null = null;
  const animations = new Set<Animation>();
  const overflow = element.style.overflow;
  const abort = (animation: Animation) => {
    animation.onfinish = null;
    animation.cancel();
    animation.effect = null;
    animations.delete(animation);
  };
  return {
    to(target: 0 | 1, finish: () => void) {
      const config = (configuration ??= options()),
        previous = current;
      if (previous) previous.finish = () => {};
      let animation = element.animate(
        previous ? [] : [config.pose(1 - target), config.pose(1 - target)],
        { duration: 0, fill: "forwards" },
      );
      animations.add(animation);
      const flight: Flight = {
        progress: () => 1 - target,
        abort: () => abort(animation),
        finish,
      };
      current = flight;
      animation.onfinish = () => {
        abort(animation);
        const start = previous?.progress() ?? 1 - target;
        previous?.abort();
        const delta = target - start,
          duration = config.duration * Math.abs(delta);
        const frames = duration
          ? nativeFrames(
              duration,
              (t) => config.pose(start + delta * t),
              config.power,
            )
          : [];
        if (frames.some((frame) => frame.overflow === "hidden"))
          element.style.overflow = "hidden";
        animation = element.animate(frames, { duration, fill: "forwards" });
        animations.add(animation);
        flight.progress = () => {
          const time = Math.max(
            0,
            Math.min(duration, Number(animation.currentTime) || 0),
          );
          return duration
            ? start + delta * (1 - (1 - time / duration) ** config.power)
            : target;
        };
        animation.onfinish = () => {
          flight.progress = () => target;
          if (current !== flight) return;
          abort(animation);
          configuration = null;
          if (target === 1) {
            // Native intro cleanup restores the original shorthand, including longhands.
            element.style.overflow = overflow;
            if (!overflow) {
              element.style.removeProperty("overflow-x");
              element.style.removeProperty("overflow-y");
            }
          }
          flight.finish();
        };
      };
    },
    destroy() {
      for (const animation of animations) abort(animation);
      current = null;
      configuration = null;
    },
  };
}
export function useNativeTransition(
  open: boolean,
  options: (element: HTMLElement) => NativeMotionOptions,
) {
  const [present, setPresent] = useState(open);
  const ref = useRef<HTMLDivElement>(null),
    motion = useRef<ReturnType<typeof createNativeTransition> | null>(null);
  useLayoutEffect(() => {
    if (open) setPresent(true);
  }, [open]);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (!element.animate) {
      if (!open) setPresent(false);
      return;
    }
    motion.current ??= createNativeTransition(element, () => options(element));
    motion.current.to(open ? 1 : 0, () => {
      if (!open) {
        motion.current?.destroy();
        motion.current = null;
        setPresent(false);
      }
    });
  }, [open, present, options]);
  useLayoutEffect(() => () => motion.current?.destroy(), []);
  return { present, ref };
}

export function nativeSlideOptions(element: HTMLElement): NativeMotionOptions {
  const style = getComputedStyle(element);
  const px = (property: string) =>
    parseFloat(style.getPropertyValue(property)) || 0;
  const values = Object.fromEntries(
    [
      "height",
      "padding-top",
      "padding-bottom",
      "margin-top",
      "margin-bottom",
      "border-top-width",
      "border-bottom-width",
    ].map((key) => [key, px(key)]),
  );
  const opacity = parseFloat(style.opacity) || 1;
  return {
    duration: 300,
    power: 5,
    pose: (t) => ({
      height: `${t * values.height}px`,
      paddingTop: `${t * values["padding-top"]}px`,
      paddingBottom: `${t * values["padding-bottom"]}px`,
      marginTop: `${t * values["margin-top"]}px`,
      marginBottom: `${t * values["margin-bottom"]}px`,
      borderTopWidth: `${t * values["border-top-width"]}px`,
      borderBottomWidth: `${t * values["border-bottom-width"]}px`,
      opacity: Math.min(t * 20, 1) * opacity,
      overflow: "hidden",
      minHeight: 0,
    }),
  };
}
