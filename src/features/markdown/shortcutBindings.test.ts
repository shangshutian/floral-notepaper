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
    expect(isReservedMarkdownBinding("Ctrl+Shift+7")).toBe(false);
  });
});

describe("findShortcutConflict", () => {
  test("detects a binding already used by another action", () => {
    expect(findShortcutConflict(DEFAULT_MARKDOWN_SHORTCUTS, "bold", "Ctrl+I")).toBe("italic");
    expect(findShortcutConflict(DEFAULT_MARKDOWN_SHORTCUTS, "bold", "Ctrl+Shift+B")).toBeNull();
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
    const bindings = resolveMarkdownShortcutBindings({ bold: "Ctrl+Shift+B", ul: "Ctrl+Shift+U" });

    expect(bindings.bold).toBe("Ctrl+Shift+B");
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
});
