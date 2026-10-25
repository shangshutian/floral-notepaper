import type { MarkdownCommand } from "./commands";
import {
  DEFAULT_MARKDOWN_SHORTCUTS,
  MARKDOWN_SHORTCUT_IDS,
  commandForShortcutId,
  keyFromShortcutEvent,
  parseMarkdownBinding,
  type MarkdownShortcutBindings,
  type ShortcutBindingEvent,
} from "./shortcutBindings";

/**
 * 纯 `KeyboardEvent` → `MarkdownCommand` 映射（配置驱动）。
 *
 * 这里刻意不碰 DOM：不读 textarea、不调用 preventDefault，
 * 只回答"这个按键组合对应哪个 command"，便于独立测试。
 *
 * 绑定表来自 Settings（config.json 的 markdownShortcuts），
 * 未配置的项回落到 DEFAULT_MARKDOWN_SHORTCUTS。
 * 未命中的组合一律返回 `null`，由浏览器 / 编辑器保持原行为
 * （Ctrl+Z / Ctrl+Y / Ctrl+S / Ctrl+A / Ctrl+C / Ctrl+V / Ctrl+X / Tab / Escape …）。
 */

export interface MarkdownShortcutEvent extends ShortcutBindingEvent {
  isComposing?: boolean;
  keyCode?: number;
}

/**
 * 中文 IME 组合态保护：composition 期间按键属于候选框，不能当作快捷键。
 * `keyCode === 229` 是部分 IME / 浏览器在组合态上报的 legacy 标记。
 */
export function isImeComposing(event: MarkdownShortcutEvent): boolean {
  return Boolean(event.isComposing) || event.keyCode === 229;
}

export function resolveMarkdownShortcut(
  event: MarkdownShortcutEvent,
  bindings: MarkdownShortcutBindings = DEFAULT_MARKDOWN_SHORTCUTS,
): MarkdownCommand | null {
  if (isImeComposing(event)) return null;

  // Markdown 快捷键必须带主修饰键，否则会和正常输入冲突
  const ctrl = Boolean(event.ctrlKey);
  const meta = Boolean(event.metaKey);
  if (!ctrl && !meta) return null;

  const key = keyFromShortcutEvent(event);
  if (!key) return null;

  const alt = Boolean(event.altKey);
  const shift = Boolean(event.shiftKey);

  for (const id of MARKDOWN_SHORTCUT_IDS) {
    const binding = parseMarkdownBinding(bindings[id]);
    if (!binding) continue;
    if (binding.key !== key) continue;
    // Ctrl / Command 互为别名，沿用仓库既有 `ctrlKey || metaKey` 约定
    if (!binding.ctrl && !binding.meta) continue;
    if (binding.alt !== alt || binding.shift !== shift) continue;
    return commandForShortcutId(id);
  }

  return null;
}
