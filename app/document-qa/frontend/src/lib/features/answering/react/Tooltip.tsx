import { useEffect, useRef, type ReactNode } from "react";
import tippy, { type Placement } from "tippy.js";
/** Fixed application-owned strings only, matching the native Tooltip defaults. */
export function Tooltip({
  content,
  placement = "top",
  className = "flex",
  children,
}: {
  content: string;
  placement?: Placement;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const instance = tippy(ref.current, {
      content,
      placement,
      allowHTML: false,
      touch: true,
      theme: "dark",
      arrow: false,
      offset: [0, 4],
    });
    return () => instance.destroy();
  }, [content, placement]);
  return (
    <div className={className} ref={ref}>
      {children}
    </div>
  );
}
