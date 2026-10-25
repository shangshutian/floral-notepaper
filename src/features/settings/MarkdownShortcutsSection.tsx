import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DEFAULT_MARKDOWN_SHORTCUTS,
  MARKDOWN_SHORTCUT_IDS,
  bindingFromShortcutEvent,
  findShortcutConflict,
  formatMarkdownBinding,
  resolveMarkdownShortcutBindings,
  type MarkdownShortcutId,
} from "../markdown/shortcutBindings";
import type { AppConfig } from "./types";

const LABEL_KEYS = {
  bold: "settings.markdownShortcuts.action.bold",
  italic: "settings.markdownShortcuts.action.italic",
  link: "settings.markdownShortcuts.action.link",
  heading1: "settings.markdownShortcuts.action.heading1",
  heading2: "settings.markdownShortcuts.action.heading2",
  heading3: "settings.markdownShortcuts.action.heading3",
  heading4: "settings.markdownShortcuts.action.heading4",
  heading5: "settings.markdownShortcuts.action.heading5",
  heading6: "settings.markdownShortcuts.action.heading6",
  ol: "settings.markdownShortcuts.action.ol",
  ul: "settings.markdownShortcuts.action.ul",
  inlineCode: "settings.markdownShortcuts.action.inlineCode",
  codeBlock: "settings.markdownShortcuts.action.codeBlock",
  inlineMath: "settings.markdownShortcuts.action.inlineMath",
  blockMath: "settings.markdownShortcuts.action.blockMath",
  table: "settings.markdownShortcuts.action.table",
} as const satisfies Record<MarkdownShortcutId, string>;

const LABEL_FALLBACKS = {
  bold: "粗体",
  italic: "斜体",
  link: "链接",
  heading1: "标题 1",
  heading2: "标题 2",
  heading3: "标题 3",
  heading4: "标题 4",
  heading5: "标题 5",
  heading6: "标题 6",
  ol: "有序列表",
  ul: "无序列表",
  inlineCode: "行内代码",
  codeBlock: "代码块",
  inlineMath: "行内公式",
  blockMath: "块级公式",
  table: "表格",
} as const satisfies Record<MarkdownShortcutId, string>;

interface MarkdownShortcutsSectionProps {
  config: AppConfig;
  onChange: (config: AppConfig) => void;
}

/**
 * Markdown 编辑快捷键设置区。
 *
 * 只负责"捕获组合键 → 校验 → 写回 config.markdownShortcuts"，
 * 真正的按键派发在 features/markdown/shortcuts.ts，两边共用同一份绑定表。
 */
export function MarkdownShortcutsSection({ config, onChange }: MarkdownShortcutsSectionProps) {
  const { t } = useTranslation();
  const bindings = useMemo(
    () => resolveMarkdownShortcutBindings(config.markdownShortcuts),
    [config.markdownShortcuts],
  );
  const [recordingId, setRecordingId] = useState<MarkdownShortcutId | null>(null);
  const [error, setError] = useState<string | null>(null);

  const actionLabel = (id: MarkdownShortcutId) =>
    t(LABEL_KEYS[id], { defaultValue: LABEL_FALLBACKS[id] });

  const save = (id: MarkdownShortcutId, binding: string) => {
    onChange({ ...config, markdownShortcuts: { ...bindings, [id]: binding } });
  };

  const resetOne = (id: MarkdownShortcutId) => {
    const fallback = DEFAULT_MARKDOWN_SHORTCUTS[id];
    const conflict = findShortcutConflict(bindings, id, fallback);
    if (conflict) {
      setError(
        t("settings.markdownShortcuts.errorConflict", {
          defaultValue: "与「{{action}}」冲突",
          action: actionLabel(conflict),
        }),
      );
      return;
    }
    setError(null);
    save(id, fallback);
  };

  const resetAll = () => {
    setRecordingId(null);
    setError(null);
    onChange({ ...config, markdownShortcuts: {} });
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    const activeId = recordingId;
    if (!activeId) return;

    event.preventDefault();
    event.stopPropagation();

    if (event.key === "Escape") {
      setRecordingId(null);
      setError(null);
      return;
    }

    const result = bindingFromShortcutEvent(event);
    if (result.status === "modifierOnly") return;

    if (result.status === "ok") {
      const conflict = findShortcutConflict(bindings, activeId, result.binding);
      if (conflict) {
        setError(
          t("settings.markdownShortcuts.errorConflict", {
            defaultValue: "与「{{action}}」冲突",
            action: actionLabel(conflict),
          }),
        );
        return;
      }
      save(activeId, result.binding);
      setRecordingId(null);
      setError(null);
      return;
    }

    if (result.status === "reserved") {
      setError(
        t("settings.markdownShortcuts.errorReserved", {
          defaultValue: "该组合由编辑器保留（撤销/保存/剪贴板），不能绑定",
        }),
      );
      return;
    }

    if (result.status === "needsModifier") {
      setError(
        t("settings.markdownShortcuts.errorNeedsModifier", {
          defaultValue: "必须包含 Ctrl 或 Command",
        }),
      );
      return;
    }

    setError(
      t("settings.markdownShortcuts.errorUnsupported", {
        defaultValue: "不支持该按键，请用字母、数字或符号",
      }),
    );
  };

  // handler 每帧都是新的（依赖 config/bindings/t），用 ref 保持注册只随录制状态变化
  const handleKeyDownRef = useRef(handleKeyDown);
  handleKeyDownRef.current = handleKeyDown;

  useEffect(() => {
    if (!recordingId) return undefined;
    const listener = (event: KeyboardEvent) => handleKeyDownRef.current(event);
    document.addEventListener("keydown", listener, true);
    return () => document.removeEventListener("keydown", listener, true);
  }, [recordingId]);

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="block text-[11px] font-body text-ink-faint">
          {t("settings.markdownShortcuts.title", { defaultValue: "Markdown 快捷键" })}
        </label>
        <button
          type="button"
          onClick={resetAll}
          disabled={!config.markdownShortcuts || Object.keys(config.markdownShortcuts).length === 0}
          className="text-[10px] text-ink-ghost hover:text-ink-soft disabled:opacity-40 disabled:hover:text-ink-ghost transition-colors cursor-pointer disabled:cursor-default"
        >
          {t("settings.markdownShortcuts.resetAll", { defaultValue: "全部恢复默认" })}
        </button>
      </div>
      <p className="text-[10px] leading-relaxed text-ink-ghost">
        {t("settings.markdownShortcuts.description", {
          defaultValue: "点击组合键后按下新快捷键，Esc 取消。快捷键只在编辑区生效。",
        })}
      </p>

      <div className="space-y-1">
        {MARKDOWN_SHORTCUT_IDS.map((id) => {
          const isRecording = recordingId === id;
          const isDefault = bindings[id] === DEFAULT_MARKDOWN_SHORTCUTS[id];
          return (
            <div key={id} className="flex items-center gap-1.5 h-7">
              <span className="flex-1 text-[12px] text-ink-soft truncate">{actionLabel(id)}</span>
              <button
                type="button"
                onClick={() => {
                  setRecordingId(isRecording ? null : id);
                  setError(null);
                }}
                title={t("settings.markdownShortcuts.recording", { defaultValue: "按下组合键…" })}
                className={`min-w-[92px] px-2 h-6 rounded-md border text-[11px] font-mono tabular-nums transition-colors cursor-pointer ${
                  isRecording
                    ? "border-bamboo/60 bg-bamboo/10 text-bamboo"
                    : "border-paper-deep/30 bg-paper-warm/40 text-ink-soft hover:border-bamboo/40"
                }`}
              >
                {isRecording
                  ? t("settings.markdownShortcuts.recording", { defaultValue: "按下组合键…" })
                  : formatMarkdownBinding(bindings[id])}
              </button>
              <button
                type="button"
                onClick={() => resetOne(id)}
                disabled={isDefault}
                title={t("settings.markdownShortcuts.resetOne", { defaultValue: "恢复默认" })}
                className="w-6 h-6 flex items-center justify-center rounded-md text-[11px] text-ink-ghost hover:text-ink-soft hover:bg-paper-warm disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink-ghost transition-colors cursor-pointer disabled:cursor-default"
              >
                ↺
              </button>
            </div>
          );
        })}
      </div>

      {error && <p className="text-[10px] text-red-400 leading-relaxed">{error}</p>}
    </section>
  );
}
