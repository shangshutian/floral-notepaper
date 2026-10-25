import { afterEach, describe, expect, test, vi } from "vitest";
import type { TFunction } from "i18next";
import { DEFAULT_MARKDOWN_SHORTCUTS } from "./shortcutBindings";
import { createMarkdownShortcutHandler, createUndoSelectionGuard } from "./useMarkdownShortcuts";
import type { MarkdownShortcutDependencies } from "./useMarkdownShortcuts";

const translate = ((key: string, options?: { defaultValue?: string }) =>
  options?.defaultValue ?? key) as unknown as TFunction;

interface FakeTextarea {
  value: string;
  selectionStart: number;
  selectionEnd: number;
  scrollTop: number;
  disabled: boolean;
  focus: () => void;
  setSelectionRange: (start: number, end: number) => void;
}

function makeTextarea(value: string, start = 0, end = start) {
  const element: FakeTextarea = {
    value,
    selectionStart: start,
    selectionEnd: end,
    scrollTop: 0,
    disabled: false,
    focus: vi.fn(),
    setSelectionRange(nextStart: number, nextEnd: number) {
      this.selectionStart = nextStart;
      this.selectionEnd = nextEnd;
    },
  };
  return element as FakeTextarea & HTMLTextAreaElement;
}

function makeEvent(target: unknown, init: Record<string, unknown> = {}) {
  const preventDefault = vi.fn();
  const stopPropagation = vi.fn();
  const event = {
    key: "b",
    code: "KeyB",
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    keyCode: 0,
    target,
    preventDefault,
    stopPropagation,
    ...init,
  };
  return { event: event as unknown as KeyboardEvent, preventDefault, stopPropagation };
}

function stubEditorGlobals() {
  const execCommand = vi.fn(() => true);
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("document", { execCommand });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  return {
    execCommand,
    flushFrames() {
      for (const callback of frames.splice(0)) callback(0);
    },
  };
}

function makeDependencies(
  overrides: Partial<MarkdownShortcutDependencies> = {},
): MarkdownShortcutDependencies & {
  setContent: ReturnType<typeof vi.fn>;
  markDirty: ReturnType<typeof vi.fn>;
} {
  const setContent = vi.fn();
  const markDirty = vi.fn();
  return { setContent, markDirty, translate, ...overrides } as MarkdownShortcutDependencies & {
    setContent: ReturnType<typeof vi.fn>;
    markDirty: ReturnType<typeof vi.fn>;
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("createMarkdownShortcutHandler — dispatch", () => {
  test("applies the mapped command to the focused textarea", () => {
    const { execCommand } = stubEditorGlobals();
    const textarea = makeTextarea("hi", 0, 2);
    const dependencies = makeDependencies();
    const handler = createMarkdownShortcutHandler({
      getTextarea: () => textarea,
      getDependencies: () => dependencies,
    });
    const { event, preventDefault } = makeEvent(textarea);

    handler(event);

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(execCommand).toHaveBeenCalledWith("insertText", false, "**hi**");
    expect(dependencies.setContent).toHaveBeenCalledWith("**hi**");
    expect(dependencies.markDirty).toHaveBeenCalledTimes(1);
  });

  test("exact heading shortcuts reach the same command layer", () => {
    const { execCommand } = stubEditorGlobals();
    const textarea = makeTextarea("title", 0, 0);
    const dependencies = makeDependencies();
    const handler = createMarkdownShortcutHandler({
      getTextarea: () => textarea,
      getDependencies: () => dependencies,
    });
    const { event } = makeEvent(textarea, { key: "3", code: "Digit3" });

    handler(event);

    // 只插入标题记号本身，不重写整篇内容
    expect(execCommand).toHaveBeenCalledWith("insertText", false, "### ");
    expect(dependencies.setContent).toHaveBeenCalledWith("### title");
  });

  test("honours custom bindings and releases the old ones", () => {
    const { execCommand } = stubEditorGlobals();
    const textarea = makeTextarea("hi", 0, 2);
    const dependencies = makeDependencies({
      bindings: { ...DEFAULT_MARKDOWN_SHORTCUTS, bold: "Ctrl+Shift+B" },
    });
    const handler = createMarkdownShortcutHandler({
      getTextarea: () => textarea,
      getDependencies: () => dependencies,
    });

    const oldBinding = makeEvent(textarea, { key: "b", code: "KeyB" });
    handler(oldBinding.event);
    expect(oldBinding.preventDefault).not.toHaveBeenCalled();
    expect(execCommand).not.toHaveBeenCalled();

    const newBinding = makeEvent(textarea, { key: "B", code: "KeyB", shiftKey: true });
    handler(newBinding.event);
    expect(newBinding.preventDefault).toHaveBeenCalledTimes(1);
    expect(execCommand).toHaveBeenCalledWith("insertText", false, "**hi**");
  });

  test("reports the applied edit so the undo guard can bound itself", () => {
    stubEditorGlobals();
    const textarea = makeTextarea("abc hi def", 4, 6);
    const applied: Array<{ replaceStart: number }> = [];
    const handler = createMarkdownShortcutHandler({
      getTextarea: () => textarea,
      getDependencies: () => makeDependencies(),
      onApplied: (edit) => applied.push({ replaceStart: edit.replaceStart }),
    });

    handler(makeEvent(textarea).event);

    expect(applied).toEqual([{ replaceStart: 4 }]);
  });
});

describe("createMarkdownShortcutHandler — boundaries", () => {
  test("keys outside the mapping table are left untouched", () => {
    const { execCommand } = stubEditorGlobals();
    const textarea = makeTextarea("hi", 0, 2);
    const dependencies = makeDependencies();
    const handler = createMarkdownShortcutHandler({
      getTextarea: () => textarea,
      getDependencies: () => dependencies,
    });
    const { event, preventDefault } = makeEvent(textarea, { key: "z", code: "KeyZ" });

    handler(event);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(execCommand).not.toHaveBeenCalled();
    expect(dependencies.setContent).not.toHaveBeenCalled();
  });

  test("events from other elements (e.g. the notepad title input) are ignored", () => {
    const { execCommand } = stubEditorGlobals();
    const textarea = makeTextarea("hi", 0, 2);
    const titleInput = {} as unknown as HTMLInputElement;
    const dependencies = makeDependencies();
    const handler = createMarkdownShortcutHandler({
      getTextarea: () => textarea,
      getDependencies: () => dependencies,
    });
    const { event, preventDefault } = makeEvent(titleInput);

    handler(event);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(execCommand).not.toHaveBeenCalled();
  });

  test("IME composition never triggers a command", () => {
    const { execCommand } = stubEditorGlobals();
    const textarea = makeTextarea("ni", 0, 2);
    const dependencies = makeDependencies();
    const handler = createMarkdownShortcutHandler({
      getTextarea: () => textarea,
      getDependencies: () => dependencies,
    });
    const { event, preventDefault } = makeEvent(textarea, { isComposing: true });

    handler(event);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(execCommand).not.toHaveBeenCalled();
  });

  test("disabled textareas and disabled hooks do nothing", () => {
    const { execCommand } = stubEditorGlobals();
    const disabledTextarea = makeTextarea("hi", 0, 2);
    disabledTextarea.disabled = true;
    const enabledTextarea = makeTextarea("hi", 0, 2);

    const disabledHandler = createMarkdownShortcutHandler({
      getTextarea: () => disabledTextarea,
      getDependencies: () => makeDependencies(),
    });
    const { event } = makeEvent(disabledTextarea);
    disabledHandler(event);

    const gatedHandler = createMarkdownShortcutHandler({
      getTextarea: () => enabledTextarea,
      getDependencies: () => makeDependencies({ enabled: false }),
    });
    const gated = makeEvent(enabledTextarea);
    gatedHandler(gated.event);

    expect(gated.preventDefault).not.toHaveBeenCalled();
    expect(execCommand).not.toHaveBeenCalled();
  });

  test("a missing textarea (preview mode / tile mode) is a no-op", () => {
    const { execCommand } = stubEditorGlobals();
    const handler = createMarkdownShortcutHandler({
      getTextarea: () => null,
      getDependencies: () => makeDependencies(),
    });
    const { event, preventDefault } = makeEvent(null);

    handler(event);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(execCommand).not.toHaveBeenCalled();
  });
});

/**
 * R2-A：WebView2 撤销我们自己的 command 时，如果它把整篇内容还原成"全选"，
 * 这里必须把光标收敛回上一个编辑点，不能让 textarea 停在整篇全选。
 */
describe("createUndoSelectionGuard", () => {
  function makeInputEvent(textarea: unknown, inputType: string) {
    return { inputType, target: textarea } as unknown as Event;
  }

  function setup(textarea: HTMLTextAreaElement, start: number) {
    const { flushFrames } = stubEditorGlobals();
    const guard = createUndoSelectionGuard({
      getTextarea: () => textarea,
      getLastEditRange: () => ({ start }),
    });
    return { guard, flushFrames };
  }

  test("collapses a whole-document selection left by undo", () => {
    const textarea = makeTextarea("**hello**", 0, 9);
    const { guard, flushFrames } = setup(textarea, 4);

    guard(makeInputEvent(textarea, "historyUndo"));
    flushFrames();

    expect(textarea.selectionStart).toBe(4);
    expect(textarea.selectionEnd).toBe(4);
  });

  test("applies to redo as well", () => {
    const textarea = makeTextarea("**hello**", 0, 9);
    const { guard, flushFrames } = setup(textarea, 0);

    guard(makeInputEvent(textarea, "historyRedo"));
    flushFrames();

    expect(textarea.selectionStart).toBe(0);
    expect(textarea.selectionEnd).toBe(0);
  });

  test("leaves a partial selection alone", () => {
    const textarea = makeTextarea("**hello**", 2, 7);
    const { guard, flushFrames } = setup(textarea, 4);

    guard(makeInputEvent(textarea, "historyUndo"));
    flushFrames();

    expect(textarea.selectionStart).toBe(2);
    expect(textarea.selectionEnd).toBe(7);
  });

  test("ignores non-history input events and other targets", () => {
    const textarea = makeTextarea("**hello**", 0, 9);
    const { guard, flushFrames } = setup(textarea, 4);

    guard(makeInputEvent(textarea, "insertText"));
    guard({ inputType: "historyUndo", target: {} } as unknown as Event);
    flushFrames();

    expect(textarea.selectionStart).toBe(0);
    expect(textarea.selectionEnd).toBe(9);
  });
});
