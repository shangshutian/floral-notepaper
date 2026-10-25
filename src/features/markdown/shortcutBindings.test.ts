import { describe, expect, test } from "vitest";
import {
  DEFAULT_MARKDOWN_SHORTCUTS,
  MARKDOWN_SHORTCUT_IDS,
  bindingFromShortcutEvent,
  commandForShortcutId,
  findShortcutConflict,
  formatMarkdownBinding,
  isReservedMarkdownBinding,
  keyFromShortcutEvent,
  normalizeMarkdownBinding,
  parseMarkdownBinding,
  resolveMarkdownShortcutBindings,
} from "./shortcutBindings";

describe("binding strings", () => {
  test("normalizes modifier order and letter case", () => {
    expect(normalizeMarkdownBinding("ctrl+b")).toBe("Ctrl+B");
    expect(normalizeMarkdownBinding("Shift+Ctrl+B")).toBe("Ctrl+Shift+B");
    expect(normalizeMarkdownBinding("Ctrl+Shift+7")).toBe("Ctrl+Shift+7");
  });

  test("rejects bindings without a Ctrl/Command modifier", () => {
    expect(normalizeMarkdownBinding("B")).toBeNull();
    expect(normalizeMarkdownBinding("Shift+B")).toBeNull();
    expect(normalizeMarkdownBinding("Alt+B")).toBeNull();
  });

  test("rejects non printable keys so basic editing is never hijacked", () => {
    expect(normalizeMarkdownBinding("Ctrl+Tab")).toBeNull();
    expect(normalizeMarkdownBinding("Ctrl+Escape")).toBeNull();
    expect(normalizeMarkdownBinding("Ctrl+Backspace")).toBeNull();
    expect(normalizeMarkdownBinding("Ctrl+ArrowLeft")).toBeNull();
    expect(normalizeMarkdownBinding("Ctrl+ ")).toBeNull();
  });

  test("formats bindings for the settings panel", () => {
    expect(formatMarkdownBinding("Ctrl+B")).toBe("Ctrl + B");
    expect(formatMarkdownBinding("Ctrl+Shift+7")).toBe("Ctrl + Shift + 7");
  });

  test("parsing keeps punctuation keys intact", () => {
    expect(parseMarkdownBinding("Ctrl+[")).toMatchObject({ ctrl: true, key: "[" });
    expect(parseMarkdownBinding("Ctrl+`")).toMatchObject({ ctrl: true, key: "`" });
  });
});

describe("keyFromShortcutEvent", () => {
  test("uses the physical key so non-Latin layouts still work", () => {
    expect(keyFromShortcutEvent({ key: "и", code: "KeyB" })).toBe("b");
    expect(keyFromShortcutEvent({ key: "&", code: "Digit7" })).toBe("7");
    expect(keyFromShortcutEvent({ key: "3", code: "Numpad3" })).toBe("3");
  });

  test("falls back to event.key when no code is available", () => {
    expect(keyFromShortcutEvent({ key: "B" })).toBe("b");
    expect(keyFromShortcutEvent({ key: "[" })).toBe("[");
  });

  test("multi-character keys are unsupported", () => {
    expect(keyFromShortcutEvent({ key: "Tab", code: "Tab" })).toBeNull();
    expect(keyFromShortcutEvent({ key: "Escape", code: "Escape" })).toBeNull();
    expect(keyFromShortcutEvent({ key: "Dead" })).toBeNull();
  });
});

describe("bindingFromShortcutEvent", () => {
  test("captures a full combination", () => {
    expect(
      bindingFromShortcutEvent({ key: "B", code: "KeyB", ctrlKey: true, shiftKey: true }),
    ).toEqual({ status: "ok", binding: "Ctrl+Shift+B" });
  });

  test("digit rows use the digit, not the shifted symbol", () => {
    // Ctrl+Shift+1 在 US 布局下 event.key 是 "!"，必须靠 Digit1 还原成 "1"
    expect(
      bindingFromShortcutEvent({ key: "!", code: "Digit1", ctrlKey: true, shiftKey: true }),
    ).toEqual({ status: "ok", binding: "Ctrl+Shift+1" });
    expect(
      bindingFromShortcutEvent({ key: "&", code: "Digit7", ctrlKey: true, shiftKey: true }),
    ).toEqual({ status: "ok", binding: "Ctrl+Shift+7" });
  });

  test("modifier-only presses keep waiting", () => {
    expect(bindingFromShortcutEvent({ key: "Shift", code: "ShiftLeft", shiftKey: true })).toEqual({
      status: "modifierOnly",
    });
  });

  test("plain keys need a modifier", () => {
    expect(bindingFromShortcutEvent({ key: "b", code: "KeyB" })).toEqual({
      status: "needsModifier",
    });
  });

  test("reserved combinations are refused", () => {
    for (const pressed of ["z", "y", "s", "a", "c", "v", "x"]) {
      expect(
        bindingFromShortcutEvent({
          key: pressed,
          code: `Key${pressed.toUpperCase()}`,
          ctrlKey: true,
        }),
      ).toEqual({ status: "reserved" });
    }
  });

  test("unsupported keys are refused", () => {
    expect(bindingFromShortcutEvent({ key: "Tab", code: "Tab", ctrlKey: true })).toEqual({
      status: "unsupported",
    });
  });
});

describe("isReservedMarkdownBinding", () => {
  test("marks undo/redo, save and clipboard as reserved", () => {
    expect(isReservedMarkdownBinding("Ctrl+Z")).toBe(true);
    expect(isReservedMarkdownBinding("Ctrl+Y")).toBe(true);
    expect(isReservedMarkdownBinding("Ctrl+S")).toBe(true);
    expect(isReservedMarkdownBinding("Ctrl+B")).toBe(false);
    expect(isReservedMarkdownBinding("Ctrl+Shift+1")).toBe(false);
  });
});

describe("findShortcutConflict", () => {
  test("detects a binding already used by another action", () => {
    expect(findShortcutConflict(DEFAULT_MARKDOWN_SHORTCUTS, "bold", "Ctrl+I")).toBe("italic");
    // Ctrl+Shift+B 在 M1.1 之后归表格所有
    expect(findShortcutConflict(DEFAULT_MARKDOWN_SHORTCUTS, "bold", "Ctrl+Shift+B")).toBe("table");
    expect(findShortcutConflict(DEFAULT_MARKDOWN_SHORTCUTS, "bold", "Ctrl+Shift+U")).toBeNull();
  });

  test("ignores the action's own current binding", () => {
    expect(findShortcutConflict(DEFAULT_MARKDOWN_SHORTCUTS, "bold", "Ctrl+B")).toBeNull();
  });
});

describe("resolveMarkdownShortcutBindings", () => {
  test("returns the defaults when nothing is configured", () => {
    expect(resolveMarkdownShortcutBindings()).toEqual(DEFAULT_MARKDOWN_SHORTCUTS);
    expect(resolveMarkdownShortcutBindings({})).toEqual(DEFAULT_MARKDOWN_SHORTCUTS);
    expect(resolveMarkdownShortcutBindings(null)).toEqual(DEFAULT_MARKDOWN_SHORTCUTS);
  });

  test("applies valid overrides on top of the defaults", () => {
    const bindings = resolveMarkdownShortcutBindings({ bold: "Ctrl+Alt+B", ul: "Ctrl+Shift+U" });

    expect(bindings.bold).toBe("Ctrl+Alt+B");
    expect(bindings.ul).toBe("Ctrl+Shift+U");
    expect(bindings.italic).toBe("Ctrl+I");
  });

  test("ignores invalid, reserved and unknown overrides", () => {
    const bindings = resolveMarkdownShortcutBindings({
      bold: "Shift+B",
      italic: "Ctrl+S",
      link: "Ctrl+\t",
      unknownAction: "Ctrl+Q",
    });

    expect(bindings).toEqual(DEFAULT_MARKDOWN_SHORTCUTS);
  });

  test("ignores an override that would duplicate another binding", () => {
    const bindings = resolveMarkdownShortcutBindings({ bold: "Ctrl+I" });

    expect(bindings.bold).toBe("Ctrl+B");
    expect(bindings.italic).toBe("Ctrl+I");
  });

  test("always produces a complete, conflict-free table", () => {
    const bindings = resolveMarkdownShortcutBindings({ bold: "Ctrl+I", italic: "Ctrl+B" });

    for (const id of MARKDOWN_SHORTCUT_IDS) {
      expect(typeof bindings[id]).toBe("string");
    }
    const seen = new Set(MARKDOWN_SHORTCUT_IDS.map((id) => normalizeMarkdownBinding(bindings[id])));
    expect(seen.size).toBe(MARKDOWN_SHORTCUT_IDS.length);
  });
});

describe("commandForShortcutId", () => {
  test("maps ids back to commands", () => {
    expect(commandForShortcutId("bold")).toBe("bold");
    expect(commandForShortcutId("ul")).toBe("ul");
    expect(commandForShortcutId("heading6")).toEqual({ type: "setHeading", level: 6 });
    expect(commandForShortcutId("heading1")).toEqual({ type: "setHeading", level: 1 });
  });

  test("maps the M1.1 ids to their commands", () => {
    expect(commandForShortcutId("inlineCode")).toBe("inlineCode");
    expect(commandForShortcutId("codeBlock")).toBe("codeBlock");
    expect(commandForShortcutId("inlineMath")).toBe("inlineMath");
    expect(commandForShortcutId("blockMath")).toBe("blockMath");
    expect(commandForShortcutId("table")).toBe("table");
  });
});

describe("M1.1 defaults", () => {
  test("list, code and math actions ship with the shortcut table from the spec", () => {
    expect(DEFAULT_MARKDOWN_SHORTCUTS.ul).toBe("Ctrl+Shift+1");
    expect(DEFAULT_MARKDOWN_SHORTCUTS.ol).toBe("Ctrl+Shift+2");
    expect(DEFAULT_MARKDOWN_SHORTCUTS.inlineCode).toBe("Ctrl+Shift+Q");
    expect(DEFAULT_MARKDOWN_SHORTCUTS.codeBlock).toBe("Ctrl+Shift+W");
    expect(DEFAULT_MARKDOWN_SHORTCUTS.blockMath).toBe("Ctrl+Shift+A");
    expect(DEFAULT_MARKDOWN_SHORTCUTS.inlineMath).toBe("Ctrl+Shift+S");
    expect(DEFAULT_MARKDOWN_SHORTCUTS.table).toBe("Ctrl+Shift+B");
  });

  test("the settings panel renders digits and letters consistently", () => {
    expect(formatMarkdownBinding(DEFAULT_MARKDOWN_SHORTCUTS.ul)).toBe("Ctrl + Shift + 1");
    expect(formatMarkdownBinding(DEFAULT_MARKDOWN_SHORTCUTS.inlineCode)).toBe("Ctrl + Shift + Q");
    expect(formatMarkdownBinding(DEFAULT_MARKDOWN_SHORTCUTS.blockMath)).toBe("Ctrl + Shift + A");
  });

  test("block math avoids Ctrl+Shift+Z because that is native redo", () => {
    // Chromium / WebView2 在可编辑区域用 Ctrl+Shift+Z 做重做，
    // 默认值必须让开，否则会破坏 undo → redo 的肌肉记忆
    expect(DEFAULT_MARKDOWN_SHORTCUTS.blockMath).not.toBe("Ctrl+Shift+Z");
  });

  test("every default is unique after normalization", () => {
    const seen = new Set(
      MARKDOWN_SHORTCUT_IDS.map((id) => normalizeMarkdownBinding(DEFAULT_MARKDOWN_SHORTCUTS[id])),
    );
    expect(seen.size).toBe(MARKDOWN_SHORTCUT_IDS.length);
  });

  test("no default is a reserved combination", () => {
    for (const id of MARKDOWN_SHORTCUT_IDS) {
      expect(isReservedMarkdownBinding(DEFAULT_MARKDOWN_SHORTCUTS[id])).toBe(false);
    }
  });
});

describe("reserved combinations — shift variants are not reserved", () => {
  test("base Ctrl+key stays reserved", () => {
    for (const pressed of ["z", "y", "a", "c", "v", "x", "s"]) {
      expect(isReservedMarkdownBinding(`Ctrl+${pressed.toUpperCase()}`)).toBe(true);
    }
  });

  test("shift variants of reserved base keys stay bindable", () => {
    // Ctrl+A / Ctrl+S 是保留组合，但加上 Shift 就是另一个组合：
    // 块级公式默认 Ctrl+Shift+A、行内公式默认 Ctrl+Shift+S 正依赖这一点
    for (const binding of [
      "Ctrl+Shift+Z",
      "Ctrl+Shift+Q",
      "Ctrl+Shift+W",
      "Ctrl+Shift+A",
      "Ctrl+Shift+S",
      "Ctrl+Shift+B",
    ]) {
      expect(isReservedMarkdownBinding(binding)).toBe(false);
    }
    expect(
      bindingFromShortcutEvent({ key: "A", code: "KeyA", ctrlKey: true, shiftKey: true }),
    ).toEqual({ status: "ok", binding: "Ctrl+Shift+A" });
    expect(
      bindingFromShortcutEvent({ key: "S", code: "KeyS", ctrlKey: true, shiftKey: true }),
    ).toEqual({ status: "ok", binding: "Ctrl+Shift+S" });
  });

  test("Alt variants are bindable too", () => {
    expect(isReservedMarkdownBinding("Ctrl+Alt+V")).toBe(false);
  });

  test("the capture flow accepts Ctrl+Shift+B even though Ctrl+B is taken", () => {
    // Ctrl+B 是粗体，但 Ctrl+Shift+B 是另一个组合，表格默认就用它
    expect(
      bindingFromShortcutEvent({ key: "B", code: "KeyB", ctrlKey: true, shiftKey: true }),
    ).toEqual({ status: "ok", binding: "Ctrl+Shift+B" });
  });
});

describe("conflicts across the extended actions", () => {
  test("table owns Ctrl+Shift+B, so inline code cannot take it", () => {
    expect(findShortcutConflict(DEFAULT_MARKDOWN_SHORTCUTS, "inlineCode", "Ctrl+Shift+B")).toBe(
      "table",
    );
  });

  test("a shift variant does not collide with its base binding", () => {
    // Ctrl+B 是粗体 / Ctrl+Shift+B 是表格：同一 base key 的两个不同组合，互不影响
    expect(findShortcutConflict(DEFAULT_MARKDOWN_SHORTCUTS, "table", "Ctrl+Shift+B")).toBeNull();
    expect(findShortcutConflict(DEFAULT_MARKDOWN_SHORTCUTS, "bold", "Ctrl+Shift+B")).toBe("table");
    expect(findShortcutConflict(DEFAULT_MARKDOWN_SHORTCUTS, "table", "Ctrl+Shift+A")).toBe(
      "blockMath",
    );
  });

  test("config overrides survive for the extended actions", () => {
    const bindings = resolveMarkdownShortcutBindings({
      table: "Ctrl+Alt+T",
      blockMath: "Ctrl+Shift+Z",
    });

    expect(bindings.table).toBe("Ctrl+Alt+T");
    // Ctrl+Shift+Z 不是保留组合，用户可以自己承担覆盖 redo 的后果
    expect(bindings.blockMath).toBe("Ctrl+Shift+Z");
  });
});
