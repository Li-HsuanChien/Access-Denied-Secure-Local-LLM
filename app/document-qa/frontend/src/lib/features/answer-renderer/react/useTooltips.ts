import { useEffect, useRef } from "react";
import tippy, { type Instance, type Placement } from "tippy.js";

/** The native Tooltip's existing Tippy configuration, without a layout wrapper. */
export function useTooltips<T extends HTMLElement>(
  placement: Placement = "top",
) {
  const root = useRef<T>(null);
  useEffect(() => {
    const host = root.current;
    if (!host) return;
    const owned = new Map<HTMLElement, Instance>();
    const sync = () => {
      for (const [node, instance] of owned) {
        if (!host.contains(node)) {
          instance.destroy();
          owned.delete(node);
        }
      }
      for (const node of host.querySelectorAll<HTMLElement>("[title]")) {
        if (
          !node.matches(
            "button,time,#response-message-model-name,.renderer-code span",
          )
        )
          continue;
        const content = node.title;
        const reference = node.matches(".renderer-code span")
          ? (node.closest<HTMLElement>(".flex-1") ?? node)
          : node;
        const current = owned.get(reference);
        if (current) {
          current.setContent(content);
          continue;
        }
        if ((reference as HTMLElement & { _tippy?: Instance })._tippy) continue;
        const at =
          node.id === "response-message-model-name" ||
          node.closest(".renderer-code")
            ? "top-start"
            : placement;
        owned.set(
          reference,
          tippy(reference, {
            content,
            placement: at,
            theme: "dark",
            arrow: false,
            offset: [0, 4],
            allowHTML: false,
          }),
        );
      }
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(host, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["title"],
    });
    return () => {
      observer.disconnect();
      for (const instance of owned.values()) instance.destroy();
    };
  }, [placement]);
  return root;
}
