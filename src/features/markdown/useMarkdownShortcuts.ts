import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { TFunction } from "i18next";
import { applyMarkdownCommand, type MarkdownEdit } from "./commands";
import { DEFAULT_MARKDOWN_SHORTCUTS, type MarkdownShortcutBindings } from "./shortcutBindings";
import { resolveMarkdownShortcut } from "./shortcuts";

/**
 * 把一个 WebView 内的 Markdown 快捷键注册到 document 上。
 *
 * MainWindow 与 NotePad 是两个独立 WebView / React tree，
 * 各自调用一次本 hook，不使用 Rust global shortcut。
 * 只有事件目标**正是**传入的 textarea 时才处理，
 * 标题输入框（NotePad）等其它焦点区域不受影响。
 */

export interface MarkdownShortcutDependencies {
  setContent: (value: string) => void;
  markDirty: () => void;
  translate: TFunction;
  enabled?: boolean;
  bindings?: MarkdownShortcutBindings;
}

export interface MarkdownShortcutHandlerOptions {
  getTextarea: () => HTMLTextAreaElement | null;
  getDependencies: () => MarkdownShortcutDependencies;
  /** command 真正落地后回调（用于 undo 选区兜底） */
  onApplied?: (edit: MarkdownEdit) => void;
}

/**
 * 纯事件处理器工厂：与 React 生命周期解耦，便于独立验证
 * （目标过滤、IME 保护、preventDefault、command 分发）。
 */
export function createMarkdownShortcutHandler(
  options: MarkdownShortcutHandlerOptions,
): (event: KeyboardEvent) => void {
  return (event) => {
    const textarea = options.getTextarea();
    if (!textarea || textarea.disabled) return;
    if (event.target !== textarea) return;

    const dependencies = options.getDependencies();
    if (dependencies.enabled === false) return;

    const command = resolveMarkdownShortcut(
      event,
      dependencies.bindings ?? DEFAULT_MARKDOWN_SHORTCUTS,
    );
    if (!command) return;

    // 只在我们真正接管这个组合时才阻止默认行为，
    // Ctrl+Z / Ctrl+S / Tab 等不在映射表内的按键完全放行。
    event.preventDefault();
    const edit = applyMarkdownCommand(
      textarea,
      command,
      dependencies.translate,
      dependencies.setContent,
      dependencies.markDirty,
    );
    if (edit) options.onApplied?.(edit);
  };
}

export interface UndoSelectionGuardOptions {
  getTextarea: () => HTMLTextAreaElement | null;
  getLastEditRange: () => { start: number } | null;
}

/**
 * undo / redo 后的选区兜底。
 *
 * 正常情况下只替换最小编辑区间，WebView2 撤销时恢复的就是这一小段选区。
 * 但若这次 command 恰好作用于整篇（例如用户全选后加粗），撤销会还原
 * "整篇被选中"，textarea 停在全选状态——这正是 R1 里被投诉的现象。
 * 这里仅在**我们自己 command 的 undo/redo** 且检测到整篇全选时收敛光标，
 * 不接管 undo/redo 本身，也不保存任何历史。
 */
export function createUndoSelectionGuard(
  options: UndoSelectionGuardOptions,
): (event: Event) => void {
  return (event) => {
    const input = event as InputEvent;
    if (input.inputType !== "historyUndo" && input.inputType !== "historyRedo") return;

    const textarea = options.getTextarea();
    if (!textarea || input.target !== textarea) return;

    const last = options.getLastEditRange();
    if (!last) return;

    const { selectionStart, selectionEnd, value } = textarea;
    if (value.length === 0) return;
    if (selectionStart !== 0 || selectionEnd !== value.length) return;

    const caret = Math.min(Math.max(last.start, 0), value.length);
    requestAnimationFrame(() => textarea.setSelectionRange(caret, caret));
  };
}

export interface UseMarkdownShortcutsOptions {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  setContent: (value: string) => void;
  markDirty: () => void;
  translate: TFunction;
  bindings?: MarkdownShortcutBindings;
  enabled?: boolean;
}

export function useMarkdownShortcuts({
  textareaRef,
  setContent,
  markDirty,
  translate,
  bindings = DEFAULT_MARKDOWN_SHORTCUTS,
  enabled = true,
}: UseMarkdownShortcutsOptions) {
  // 用 ref 持有最新回调，避免每次输入（content 变化）都重新绑定 document 监听
  const dependenciesRef = useRef<MarkdownShortcutDependencies>({
    setContent,
    markDirty,
    translate,
    bindings,
    enabled,
  });
  dependenciesRef.current = { setContent, markDirty, translate, bindings, enabled };

  // 最近一次 command 的落点，仅供 undo 选区兜底使用（不是 undo 历史）
  const lastEditRef = useRef<{ start: number } | null>(null);

  useEffect(() => {
    const handler = createMarkdownShortcutHandler({
      getTextarea: () => textareaRef.current,
      getDependencies: () => dependenciesRef.current,
      onApplied: (edit) => {
        lastEditRef.current = { start: edit.replaceStart };
      },
    });
    const guard = createUndoSelectionGuard({
      getTextarea: () => textareaRef.current,
      getLastEditRange: () => lastEditRef.current,
    });

    document.addEventListener("keydown", handler);
    document.addEventListener("input", guard, true);
    return () => {
      document.removeEventListener("keydown", handler);
      document.removeEventListener("input", guard, true);
    };
  }, [textareaRef]);
}
