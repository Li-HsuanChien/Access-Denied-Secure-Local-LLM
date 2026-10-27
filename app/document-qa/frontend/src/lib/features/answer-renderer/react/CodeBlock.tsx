import { translate, useI18n } from "@/react/i18n";
import { useEffect, useRef, useState } from "react";
import { basicSetup, EditorView } from "codemirror";
import { keymap, placeholder } from "@codemirror/view";
import { Compartment, EditorState } from "@codemirror/state";
import { indentWithTab } from "@codemirror/commands";
import { acceptCompletion } from "@codemirror/autocomplete";
import { indentUnit } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { oneDark } from "@codemirror/theme-one-dark";
import { copyText } from "./exports";
import { Icon } from "./Icon";
import { Diagram } from "./Diagrams";

function CodeEditor({
  value,
  language,
  onChange,
  onSave,
}: {
  value: string;
  language: string;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    editor = useRef<EditorView | null>(null),
    callbacks = useRef({ onChange, onSave });
  callbacks.current = { onChange, onSave };
  useEffect(() => {
    if (!host.current) return;
    const theme = new Compartment(),
      grammar = new Compartment();
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          keymap.of([
            { key: "Tab", run: acceptCompletion },
            indentWithTab,
            {
              key: "Mod-s",
              run: () => {
                callbacks.current.onSave();
                return true;
              },
            },
          ]),
          indentUnit.of("    "),
          placeholder(translate("Enter your code here...")),
          EditorView.contentAttributes.of({
            "aria-label": `${language || "Plain text"} code`,
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged)
              callbacks.current.onChange(update.state.doc.toString());
          }),
          theme.of(
            document.documentElement.classList.contains("dark") ? oneDark : [],
          ),
          grammar.of([]),
        ],
      }),
    });
    editor.current = view;
    let alive = true;
    const match = languages.find(
      (item) =>
        item.alias.includes(language) ||
        item.name.toLowerCase() === language.toLowerCase(),
    );
    void match?.load().then((support) => {
      if (alive) view.dispatch({ effects: grammar.reconfigure(support) });
    });
    const observer = new MutationObserver(() =>
      view.dispatch({
        effects: theme.reconfigure(
          document.documentElement.classList.contains("dark") ? oneDark : [],
        ),
      }),
    );
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => {
      alive = false;
      observer.disconnect();
      view.destroy();
      editor.current = null;
    };
  }, [language]);
  useEffect(() => {
    const view = editor.current;
    if (view && view.state.doc.toString() !== value)
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
  }, [value]);
  return (
    <div ref={host} className="text-sm h-full w-full min-w-0 overflow-hidden" />
  );
}
export function CodeBlock({
  source,
  language,
  onSave,
  onPreview,
}: {
  source: string;
  language: string;
  onSave: (value: string) => void;
  onPreview: (kind: "html" | "svg", source: string) => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState(source),
    [collapsed, setCollapsed] = useState(false),
    [copied, setCopied] = useState(false),
    [saved, setSaved] = useState(false);
  useEffect(() => setValue(source), [source]);
  const save = () => {
    onSave(value);
    setSaved(true);
    setTimeout(() => setSaved(false), 1000);
  };
  if (["mermaid", "vega", "vega-lite"].includes(language))
    return <Diagram source={source} language={language} />;
  const button =
    "bg-none border-none transition rounded-md px-1.5 py-0.5 bg-white dark:bg-black";
  return (
    <div>
      <div
        className="relative flex flex-col rounded-2xl border border-gray-100/30 dark:border-gray-850/30 my-0.5 overflow-clip renderer-code"
        dir="ltr"
      >
        <div className="sticky top-0 left-0 right-0 py-1.5 px-3.5 gap-2 flex items-center justify-end w-full z-10 text-xs text-black dark:text-white bg-white dark:bg-black">
          <div className="flex-1 truncate">
            <span title={language}>{language}</span>
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              className={`flex gap-1 items-center ${button}`}
              onClick={() => setCollapsed(!collapsed)}
            >
              <div className="-translate-y-[0.5px]">
                <Icon name="collapse" className="size-3" strokeWidth={1.5} />
              </div>
              <div>{collapsed ? t("Expand") : t("Collapse")}</div>
            </button>
            <button
              type="button"
              className={`save-code-button ${button}`}
              onClick={save}
            >
              {saved ? t("Saved") : t("Save")}
            </button>
            <button
              type="button"
              className={`copy-code-button ${button}`}
              onClick={() => {
                void copyText(value).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1000);
                });
              }}
            >
              {copied ? t("Copied") : t("Copy")}
            </button>
            {(language === "html" || language === "svg") && (
              <button
                type="button"
                className={button}
                onClick={() => onPreview(language, value)}
              >
                {t("Preview")}
              </button>
            )}
          </div>
        </div>
        <div
          className={`language-${language} rounded-t-2xl -mt-8 rounded-b-2xl overflow-hidden`}
        >
          <div className="pt-6.5 bg-white dark:bg-black" />
          {collapsed ? (
            <div className="bg-white dark:bg-black dark:text-white rounded-b-2xl pt-1 pb-2 px-4 flex flex-col gap-2 text-xs">
              <span className="text-gray-500 italic">
                {t("{{COUNT}} hidden lines", {
                  COUNT: value.split("\n").length,
                })}
              </span>
            </div>
          ) : (
            <CodeEditor
              value={value}
              language={language}
              onChange={setValue}
              onSave={save}
            />
          )}
        </div>
      </div>
    </div>
  );
}
