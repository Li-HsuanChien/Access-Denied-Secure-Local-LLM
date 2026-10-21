import { decode } from "html-entities";
import type { RichToken } from "./markdown";
export async function copyText(value: string): Promise<void> {
  await navigator.clipboard.writeText(value);
}
export function downloadText(
  value: string,
  filename: string,
  type: string,
): void {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
export function tableCsv(token: RichToken): string {
  const quote = (value: string) => `"${decode(value).replace(/"/g, '""')}"`;
  const header = (token.header ?? []).map((cell) => quote(cell.text ?? ""));
  const rows = (token.rows ?? []).map((row) =>
    row.map((cell) =>
      quote((cell.tokens ?? []).map((part) => part.text ?? "").join("")),
    ),
  );
  return "\uFEFF" + [header, ...rows].map((row) => row.join(",")).join("\n");
}
