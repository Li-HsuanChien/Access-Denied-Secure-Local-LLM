// Native flyAndScale and slide formulas retained from the original UI transitions.
import type { ReactNode } from "react";
import {
  useNativeTransition,
  nativeSlideOptions,
} from "../../desktop-shell/react/nativeMotion";
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
