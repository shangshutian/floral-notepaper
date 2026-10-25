import type { HeadingLevel, MarkdownCommand } from "./commands";

/**
 * Markdown 快捷键的绑定模型（纯函数层）。
 *
 * 一份绑定就是一个可序列化字符串，例如 `Ctrl+B` / `Ctrl+Shift+7`，
 * 既存进 config.json，也用于设置面板显示与按键匹配。
 *
 * 这里只做"字符串 ⇄ 按键 / 校验 / 冲突"三件事，不碰 DOM，
 * 具体的事件派发在 shortcuts.ts，UI 在 settings/MarkdownShortcutsSection.tsx。
 */

export type MarkdownShortcutId =
  | "bold"
  | "italic"
  | "link"
  | "heading1"
  | "heading2"
  | "heading3"
  | "heading4"
  | "heading5"
  | "heading6"
  | "ol"
  | "ul"
  | "inlineCode"
  | "codeBlock"
  | "inlineMath"
  | "blockMath"
  | "table";

/** 顺序即设置面板的展示顺序（新增项追加在末尾，避免打乱已有位置） */
export const MARKDOWN_SHORTCUT_IDS: readonly MarkdownShortcutId[] = [
  "bold",
  "italic",
  "link",
  "heading1",
  "heading2",
  "heading3",
  "heading4",
  "heading5",
  "heading6",
  "ul",
  "ol",
  "inlineCode",
  "codeBlock",
  "inlineMath",
  "blockMath",
  "table",
];

export type MarkdownShortcutBindings = Record<MarkdownShortcutId, string>;

export const DEFAULT_MARKDOWN_SHORTCUTS: MarkdownShortcutBindings = {
  bold: "Ctrl+B",
  italic: "Ctrl+I",
  link: "Ctrl+K",
  heading1: "Ctrl+1",
  heading2: "Ctrl+2",
  heading3: "Ctrl+3",
  heading4: "Ctrl+4",
  heading5: "Ctrl+5",
  heading6: "Ctrl+6",
  // 数字键走 event.code（Digit1/Digit2），Shift 后即使 event.key 变成 "!" / "@"
  // 也能稳定命中，与 Ctrl+1..6 的 heading 判定同一套机制。
  ul: "Ctrl+Shift+1",
  ol: "Ctrl+Shift+2",
  inlineCode: "Ctrl+Shift+Q",
  codeBlock: "Ctrl+Shift+W",
  inlineMath: "Ctrl+Shift+S",
  // Ctrl+Shift+Z 在 Chromium / WebView2 的可编辑区域是原生 Redo（Windows），
  // 默认值必须让开，否则会破坏「撤销 → 重做」的肌肉记忆；该组合仍可手动绑定。
  blockMath: "Ctrl+Shift+A",
  table: "Ctrl+Shift+B",
};

/**
 * 编辑器 / 应用保留的按键：即使带 Ctrl 也不允许被 Markdown 快捷键占用。
 * `RESERVED_SHORTCUT_KEYS` 只描述**基础组合**（Ctrl+Z / Ctrl+Y / Ctrl+A / Ctrl+C /
 * Ctrl+V / Ctrl+X / Ctrl+S）。
 *
 * 判断时必须额外要求「没有 Shift、没有 Alt」：`Ctrl+Shift+V` 与 `Ctrl+V` 是两个
 * 不同组合，前者完全可以交给 Markdown command，不能因为 base key 相同就拒绝。
 */
export const RESERVED_SHORTCUT_KEYS: readonly string[] = ["z", "y", "a", "c", "v", "x", "s"];

export interface ParsedMarkdownBinding {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  key: string;
}

/** 单字符按键（字母 / 数字 / 符号）才允许绑定，Tab、方向键等基础编辑键一律不接管 */
function normalizeKeyChar(raw: string): string | null {
  if (raw.length !== 1) return null;
  if (raw === " ") return null;
  const lower = raw.toLowerCase();
  // 允许 a-z 与 0-9
  if (/^[a-z0-9]$/.test(lower)) return lower;
  // 其余可见 ASCII 符号原样保留（`[`、`\`、`=` 等）
  return raw.charCodeAt(0) > 0x20 ? raw : null;
}

function normalizeModifier(part: string): "ctrl" | "alt" | "shift" | "meta" | null {
  switch (part.toLowerCase()) {
    case "ctrl":
    case "control":
      return "ctrl";
    case "alt":
    case "option":
      return "alt";
    case "shift":
      return "shift";
    case "meta":
    case "command":
    case "cmd":
      return "meta";
    default:
      return null;
  }
}

export function parseMarkdownBinding(binding: string): ParsedMarkdownBinding | null {
  if (!binding) return null;
  const parts = binding.split("+");
  let rawKey = parts.pop() ?? "";
  // "Ctrl++" 这种把 '+' 本身作为按键的写法
  if (rawKey === "" && binding.endsWith("+")) rawKey = "+";

  const key = normalizeKeyChar(rawKey);
  if (!key) return null;

  const parsed: ParsedMarkdownBinding = { ctrl: false, alt: false, shift: false, meta: false, key };
  for (const part of parts) {
    if (part === "") continue;
    const modifier = normalizeModifier(part);
    if (!modifier) return null;
    parsed[modifier] = true;
  }

  if (!parsed.ctrl && !parsed.meta) return null;
  return parsed;
}

export function formatMarkdownBinding(binding: string): string {
  const parsed = parseMarkdownBinding(binding);
  if (!parsed) return binding;

  const parts: string[] = [];
  if (parsed.ctrl) parts.push("Ctrl");
  if (parsed.alt) parts.push("Alt");
  if (parsed.shift) parts.push("Shift");
  if (parsed.meta) parts.push("Meta");
  parts.push(parsed.key.length === 1 ? parsed.key.toUpperCase() : parsed.key);
  return parts.join(" + ");
}

/** 归一化为可比较、可持久化的规范字符串；非法返回 null */
export function normalizeMarkdownBinding(binding: string): string | null {
  const parsed = parseMarkdownBinding(binding);
  if (!parsed) return null;

  const parts: string[] = [];
  if (parsed.ctrl) parts.push("Ctrl");
  if (parsed.alt) parts.push("Alt");
  if (parsed.shift) parts.push("Shift");
  if (parsed.meta) parts.push("Meta");
  // 字母统一大写，让 config.json 里读起来与内置默认一致
  parts.push(/^[a-z]$/.test(parsed.key) ? parsed.key.toUpperCase() : parsed.key);
  return parts.join("+");
}

export function isReservedMarkdownBinding(binding: string): boolean {
  const parsed = parseMarkdownBinding(binding);
  if (!parsed) return true;
  if (!parsed.ctrl && !parsed.meta) return true;
  // 带 Shift / Alt 之后就不再是那个基础组合了，允许绑定
  if (parsed.shift || parsed.alt) return false;
  return RESERVED_SHORTCUT_KEYS.includes(parsed.key);
}

/** 键盘事件 → 规范化按键字符（字母/数字优先走 event.code，避免布局差异） */
export interface ShortcutBindingEvent {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

const CODE_PUNCTUATION: Record<string, string> = {
  BracketLeft: "[",
  BracketRight: "]",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
  Minus: "-",
  Equal: "=",
};

export function keyFromShortcutEvent(event: ShortcutBindingEvent): string | null {
  const code = event.code ?? "";
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1].toLowerCase();

  const digit = /^(?:Digit|Numpad)([0-9])$/.exec(code);
  if (digit) return digit[1];

  const punctuation = CODE_PUNCTUATION[code];
  if (punctuation) return punctuation;

  return normalizeKeyChar(event.key);
}

export type CaptureShortcutResult =
  | { status: "ok"; binding: string }
  /** 只按下了修饰键，继续等待主键 */
  | { status: "modifierOnly" }
  | { status: "needsModifier" }
  | { status: "reserved" }
  | { status: "unsupported" };

export function bindingFromShortcutEvent(event: ShortcutBindingEvent): CaptureShortcutResult {
  if (
    event.key === "Control" ||
    event.key === "Shift" ||
    event.key === "Alt" ||
    event.key === "Meta"
  ) {
    return { status: "modifierOnly" };
  }

  const key = keyFromShortcutEvent(event);
  if (!key) return { status: "unsupported" };

  const ctrl = Boolean(event.ctrlKey);
  const meta = Boolean(event.metaKey);
  if (!ctrl && !meta) return { status: "needsModifier" };

  const binding = normalizeMarkdownBinding(
    [
      ctrl ? "Ctrl" : "",
      event.altKey ? "Alt" : "",
      event.shiftKey ? "Shift" : "",
      meta ? "Meta" : "",
      key,
    ]
      .filter(Boolean)
      .join("+"),
  );
  if (!binding) return { status: "unsupported" };
  if (isReservedMarkdownBinding(binding)) return { status: "reserved" };
  return { status: "ok", binding };
}

/** 与其它 action 重复时返回那个 action，否则 null */
export function findShortcutConflict(
  bindings: MarkdownShortcutBindings,
  id: MarkdownShortcutId,
  binding: string,
): MarkdownShortcutId | null {
  const target = normalizeMarkdownBinding(binding);
  if (!target) return null;

  for (const otherId of MARKDOWN_SHORTCUT_IDS) {
    if (otherId === id) continue;
    if (normalizeMarkdownBinding(bindings[otherId]) === target) return otherId;
  }
  return null;
}

function hasDuplicateBindings(bindings: MarkdownShortcutBindings): boolean {
  const seen = new Set<string>();
  for (const id of MARKDOWN_SHORTCUT_IDS) {
    const normalized = normalizeMarkdownBinding(bindings[id]);
    if (!normalized) return true;
    if (seen.has(normalized)) return true;
    seen.add(normalized);
  }
  return false;
}

/**
 * 合并"用户覆盖 + 内置默认"。
 *
 * 非法 / 保留 / 会与其它项重复的覆盖会被忽略并回落到默认值，
 * 保证任何一份 config.json 都能解析出一套可用的绑定。
 */
export function resolveMarkdownShortcutBindings(
  overrides?: Record<string, string> | null,
): MarkdownShortcutBindings {
  const resolved: MarkdownShortcutBindings = { ...DEFAULT_MARKDOWN_SHORTCUTS };
  if (!overrides) return resolved;

  for (const id of MARKDOWN_SHORTCUT_IDS) {
    const raw = overrides[id];
    if (typeof raw !== "string") continue;

    const normalized = normalizeMarkdownBinding(raw);
    if (!normalized || isReservedMarkdownBinding(normalized)) continue;
    if (normalized === normalizeMarkdownBinding(resolved[id])) continue;

    const candidate = { ...resolved, [id]: normalized };
    if (hasDuplicateBindings(candidate)) continue;
    resolved[id] = normalized;
  }

  return resolved;
}

export function commandForShortcutId(id: MarkdownShortcutId): MarkdownCommand {
  switch (id) {
    case "bold":
      return "bold";
    case "italic":
      return "italic";
    case "link":
      return "link";
    case "ol":
      return "ol";
    case "ul":
      return "ul";
    case "inlineCode":
      return "inlineCode";
    case "codeBlock":
      return "codeBlock";
    case "inlineMath":
      return "inlineMath";
    case "blockMath":
      return "blockMath";
    case "table":
      return "table";
    default:
      return { type: "setHeading", level: Number(id.slice("heading".length)) as HeadingLevel };
  }
}
