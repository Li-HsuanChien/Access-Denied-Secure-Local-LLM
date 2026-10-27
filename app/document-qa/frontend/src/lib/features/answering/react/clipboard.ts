/** Native Chat copies plain text and retains its local selection fallback. */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
  const span = document.createElement("span");
  span.dataset.chatClipboard = "";
  span.textContent = text;
  Object.assign(span.style, {
    whiteSpace: "pre",
    position: "fixed",
    top: "0",
    left: "0",
    opacity: "0",
  });
  document.body.appendChild(span);
  const selection = window.getSelection(),
    range = document.createRange();
  range.selectNodeContents(span);
  selection?.removeAllRanges();
  selection?.addRange(range);
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    selection?.removeAllRanges();
    span.remove();
  }
}
