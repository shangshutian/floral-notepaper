import { describe, expect, test } from "vitest";
import { DEFAULT_MARKDOWN_SHORTCUTS, resolveMarkdownShortcutBindings } from "./shortcutBindings";
import { isImeComposing, resolveMarkdownShortcut, type MarkdownShortcutEvent } from "./shortcuts";

function key(init: Partial<MarkdownShortcutEvent> & { key: string }): MarkdownShortcutEvent {
  return {
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    keyCode: 0,
    ...init,
  };
}

describe("resolveMarkdownShortcut — default bindings", () => {
  test("Ctrl+B / Ctrl+I / Ctrl+K", () => {
    expect(resolveMarkdownShortcut(key({ key: "b", code: "KeyB" }))).toBe("bold");
    expect(resolveMarkdownShortcut(key({ key: "i", code: "KeyI" }))).toBe("italic");
    expect(resolveMarkdownShortcut(key({ key: "k", code: "KeyK" }))).toBe("link");
  });

  test("uppercase keys (CapsLock) still match", () => {
    expect(resolveMarkdownShortcut(key({ key: "B", code: "KeyB" }))).toBe("bold");
  });

  test("falls back to the physical key for non-Latin layouts", () => {
    expect(resolveMarkdownShortcut(key({ key: "и", code: "KeyB" }))).toBe("bold");
  });

  test("Cmd (metaKey) behaves like Ctrl", () => {
    expect(
      resolveMarkdownShortcut(key({ key: "b", code: "KeyB", ctrlKey: false, metaKey: true })),
    ).toBe("bold");
  });

  test("Ctrl+1 .. Ctrl+6 map to exact levels", () => {
    for (const level of [1, 2, 3, 4, 5, 6] as const) {
      expect(resolveMarkdownShortcut(key({ key: String(level), code: `Digit${level}` }))).toEqual({
        type: "setHeading",
        level,
      });
    }
  });

  test("numpad digits produce the same level", () => {
    expect(resolveMarkdownShortcut(key({ key: "3", code: "Numpad3" }))).toEqual({
      type: "setHeading",
      level: 3,
    });
  });

  test("Ctrl+Shift+7 is an ordered list and Ctrl+Shift+8 an unordered list", () => {
    expect(resolveMarkdownShortcut(key({ key: "&", code: "Digit7", shiftKey: true }))).toBe("ol");
    expect(resolveMarkdownShortcut(key({ key: "*", code: "Digit8", shiftKey: true }))).toBe("ul");
  });

  test("Ctrl+0 / Ctrl+7 are not headings", () => {
    expect(resolveMarkdownShortcut(key({ key: "0", code: "Digit0" }))).toBeNull();
    expect(resolveMarkdownShortcut(key({ key: "7", code: "Digit7" }))).toBeNull();
  });
});

describe("resolveMarkdownShortcut — custom bindings", () => {
  test("a rebound action answers on the new keys and drops the old ones", () => {
    const bindings = { ...DEFAULT_MARKDOWN_SHORTCUTS, bold: "Ctrl+Shift+B" };

    expect(resolveMarkdownShortcut(key({ key: "B", code: "KeyB", shiftKey: true }), bindings)).toBe(
      "bold",
    );
    expect(resolveMarkdownShortcut(key({ key: "b", code: "KeyB" }), bindings)).toBeNull();
  });

  test("headings can be rebound away from digits", () => {
    const bindings = { ...DEFAULT_MARKDOWN_SHORTCUTS, heading1: "Ctrl+Alt+1" };

    expect(
      resolveMarkdownShortcut(key({ key: "1", code: "Digit1", altKey: true }), bindings),
    ).toEqual({ type: "setHeading", level: 1 });
    expect(resolveMarkdownShortcut(key({ key: "1", code: "Digit1" }), bindings)).toBeNull();
  });

  test("list shortcuts can be rebound to a letter", () => {
    const bindings = { ...DEFAULT_MARKDOWN_SHORTCUTS, ul: "Ctrl+Shift+U" };

    expect(resolveMarkdownShortcut(key({ key: "U", code: "KeyU", shiftKey: true }), bindings)).toBe(
      "ul",
    );
    expect(
      resolveMarkdownShortcut(key({ key: "*", code: "Digit8", shiftKey: true }), bindings),
    ).toBeNull();
  });

  test("reserved bindings from a hand-edited config never resolve", () => {
    // resolve 阶段会把 Ctrl+Z / Ctrl+S 这类保留组合丢掉，回落默认
    const bindings = resolveMarkdownShortcutBindings({ bold: "Ctrl+Z", italic: "Ctrl+S" });

    expect(bindings.bold).toBe("Ctrl+B");
    expect(bindings.italic).toBe("Ctrl+I");
    expect(resolveMarkdownShortcut(key({ key: "z", code: "KeyZ" }), bindings)).toBeNull();
    expect(resolveMarkdownShortcut(key({ key: "s", code: "KeyS" }), bindings)).toBeNull();
  });
});

describe("resolveMarkdownShortcut — must not hijack base editing keys", () => {
  test.each(["z", "y", "s", "a", "c", "v", "x"])("Ctrl+%s is left to the editor", (pressed) => {
    expect(resolveMarkdownShortcut(key({ key: pressed }))).toBeNull();
  });

  test("plain letters, Tab and Escape are ignored", () => {
    expect(resolveMarkdownShortcut(key({ key: "b", ctrlKey: false, metaKey: false }))).toBeNull();
    expect(resolveMarkdownShortcut(key({ key: "Tab", ctrlKey: false }))).toBeNull();
    expect(resolveMarkdownShortcut(key({ key: "Escape", ctrlKey: false }))).toBeNull();
  });

  test("AltGr / Alt combinations are ignored", () => {
    expect(resolveMarkdownShortcut(key({ key: "b", altKey: true }))).toBeNull();
  });
});

describe("resolveMarkdownShortcut — IME composition guard", () => {
  test("composition events never resolve to a command", () => {
    expect(isImeComposing(key({ key: "b", isComposing: true }))).toBe(true);
    expect(resolveMarkdownShortcut(key({ key: "b", isComposing: true }))).toBeNull();
    expect(resolveMarkdownShortcut(key({ key: "1", isComposing: true }))).toBeNull();
  });

  test("keyCode 229 is treated as composing", () => {
    expect(isImeComposing(key({ key: "Process", keyCode: 229 }))).toBe(true);
    expect(resolveMarkdownShortcut(key({ key: "b", keyCode: 229 }))).toBeNull();
  });
});
