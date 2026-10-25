import { afterEach, describe, expect, test, vi } from "vitest";
import type { TFunction } from "i18next";
import { applyMarkdownCommand, computeMarkdownEdit, type MarkdownCommand } from "./commands";

// 只依赖 defaultValue 的翻译桩：断言时不引入 i18n 运行时
const translate = ((key: string, options?: { defaultValue?: string }) =>
  options?.defaultValue ?? key) as unknown as TFunction;

function edit(value: string, start: number, end: number, command: MarkdownCommand) {
  return computeMarkdownEdit(value, start, end, command, translate);
}

function range(value: string, start: number, end: number, command: MarkdownCommand) {
  const result = edit(value, start, end, command);
  if (!result) return null;
  return {
    replaceStart: result.replaceStart,
    replaceEnd: result.replaceEnd,
    replacement: result.replacement,
  };
}

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
    scrollTop: 24,
    disabled: false,
    focus: vi.fn(),
    setSelectionRange(nextStart: number, nextEnd: number) {
      this.selectionStart = nextStart;
      this.selectionEnd = nextEnd;
    },
  };
  return element as FakeTextarea & HTMLTextAreaElement;
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
    setContent: vi.fn(),
    markDirty: vi.fn(),
    flushFrames() {
      for (const callback of frames.splice(0)) callback(0);
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("computeMarkdownEdit — inline formatting", () => {
  test("bold wraps the selection and keeps it selected", () => {
    expect(edit("hello", 0, 5, "bold")).toMatchObject({
      result: "**hello**",
      cursorStart: 2,
      cursorEnd: 7,
    });
  });

  test("bold without a selection inserts the localized sample", () => {
    expect(edit("", 0, 0, "bold")).toMatchObject({
      result: "**粗体文本**",
      cursorStart: 2,
      cursorEnd: 6,
    });
  });

  test("italic wraps the selection", () => {
    expect(edit("hi", 0, 2, "italic")).toMatchObject({
      result: "*hi*",
      cursorStart: 1,
      cursorEnd: 3,
    });
  });

  test("italic without a selection inserts the localized sample", () => {
    expect(edit("", 0, 0, "italic")).toMatchObject({
      result: "*斜体文本*",
      cursorStart: 1,
      cursorEnd: 5,
    });
  });

  test("link wraps the selection and selects the url placeholder", () => {
    expect(edit("hi", 0, 2, "link")).toMatchObject({
      result: "[hi](url)",
      cursorStart: 5,
      cursorEnd: 8,
    });
  });

  test("link without a selection inserts the localized label", () => {
    expect(edit("", 0, 0, "link")).toMatchObject({
      result: "[链接文本](url)",
      cursorStart: 7,
      cursorEnd: 10,
    });
  });
});

describe("computeMarkdownEdit — exact heading", () => {
  test("adds the requested level to a plain line", () => {
    expect(edit("text", 0, 0, { type: "setHeading", level: 1 })).toMatchObject({
      result: "# text",
      cursorStart: 2,
      cursorEnd: 2,
    });
  });

  test("replaces an existing level instead of stacking prefixes", () => {
    expect(edit("# text", 0, 0, { type: "setHeading", level: 3 })).toMatchObject({
      result: "### text",
      cursorStart: 4,
      cursorEnd: 4,
    });
  });

  test("keeps the cursor after the prefix when it sits inside the line", () => {
    expect(edit("### abc", 5, 5, { type: "setHeading", level: 6 })).toMatchObject({
      result: "###### abc",
      cursorStart: 8,
      cursorEnd: 8,
    });
  });

  test("H6 is recognized as an existing heading level", () => {
    expect(edit("###### h", 0, 0, { type: "setHeading", level: 6 })).toBeNull();
    expect(edit("###### h", 0, 0, { type: "setHeading", level: 2 })).toMatchObject({
      result: "## h",
      cursorStart: 3,
      cursorEnd: 3,
    });
  });

  test("re-applying the same level is a no-op", () => {
    expect(edit("## title", 4, 4, { type: "setHeading", level: 2 })).toBeNull();
  });

  test("only the line under the cursor is changed", () => {
    expect(edit("a\nb", 2, 2, { type: "setHeading", level: 2 })).toMatchObject({
      result: "a\n## b",
      cursorStart: 5,
      cursorEnd: 5,
    });
  });
});

describe("computeMarkdownEdit — toolbar heading cycle is unchanged", () => {
  test("H1 cycles up to H2", () => {
    expect(edit("# a", 3, 3, "heading")).toMatchObject({
      result: "## a",
      cursorStart: 4,
      cursorEnd: 4,
    });
  });

  test("H5 cycles back to H1", () => {
    expect(edit("##### a", 7, 7, "heading")).toMatchObject({
      result: "# a",
      cursorStart: 3,
      cursorEnd: 3,
    });
  });

  test("a plain line gains H2", () => {
    expect(edit("abc", 3, 3, "heading")).toMatchObject({
      result: "## abc",
      cursorStart: 6,
      cursorEnd: 6,
    });
  });
});

describe("computeMarkdownEdit — block actions", () => {
  test("unordered list wraps a single line", () => {
    expect(edit("", 0, 0, "ul")).toMatchObject({
      result: "- 列表项",
      cursorStart: 2,
      cursorEnd: 5,
    });
  });

  test("unordered list prefixes every selected line", () => {
    expect(edit("a\nb", 0, 3, "ul")).toMatchObject({
      result: "- a\n- b",
      cursorStart: 0,
      cursorEnd: 7,
    });
  });

  test("ordered list numbers every selected line", () => {
    expect(edit("a\nb", 0, 3, "ol")).toMatchObject({
      result: "1. a\n2. b",
      cursorStart: 0,
      cursorEnd: 9,
    });
  });

  test("ordered list wraps a selection", () => {
    expect(edit("x", 0, 1, "ol")).toMatchObject({
      result: "1. x",
      cursorStart: 3,
      cursorEnd: 4,
    });
  });

  test("quote and inline code keep their upstream shapes", () => {
    expect(edit("x", 0, 1, "quote")).toMatchObject({
      result: "> x",
      cursorStart: 2,
      cursorEnd: 3,
    });
    expect(edit("x", 0, 1, "code")).toMatchObject({
      result: "`x`",
      cursorStart: 1,
      cursorEnd: 2,
    });
  });

  test("horizontal rule is inserted at the cursor", () => {
    expect(edit("", 0, 0, "hr")).toMatchObject({
      result: "---",
      cursorStart: 3,
      cursorEnd: 3,
    });
  });
});

/**
 * R2-A 的核心回归面：command 必须报告**最小**替换区间。
 * 只要这个区间是小的，native undo 就不会把整篇 textarea 还原成全选。
 */
describe("computeMarkdownEdit — minimal replace range (R2-A)", () => {
  test("bold on a selection only replaces that selection", () => {
    expect(range("abc hello def", 4, 9, "bold")).toEqual({
      replaceStart: 4,
      replaceEnd: 9,
      replacement: "**hello**",
    });
  });

  test("bold at the caret is a pure insertion", () => {
    expect(range("", 0, 0, "bold")).toEqual({
      replaceStart: 0,
      replaceEnd: 0,
      replacement: "**粗体文本**",
    });
  });

  test("italic and link keep the range tight around the selection", () => {
    expect(range("abc hi def", 4, 6, "italic")).toEqual({
      replaceStart: 4,
      replaceEnd: 6,
      replacement: "*hi*",
    });
    expect(range("abc hi def", 4, 6, "link")).toEqual({
      replaceStart: 4,
      replaceEnd: 6,
      replacement: "[hi](url)",
    });
  });

  test("changing a heading level only touches the marker characters", () => {
    expect(range("# text", 0, 0, { type: "setHeading", level: 3 })).toEqual({
      replaceStart: 1,
      replaceEnd: 1,
      replacement: "##",
    });
    expect(range("## a", 3, 3, "heading")).toEqual({
      replaceStart: 2,
      replaceEnd: 2,
      replacement: "#",
    });
  });

  test("list commands stay inside the selected lines", () => {
    expect(range("a\nb", 0, 3, "ul")).toEqual({
      replaceStart: 0,
      replaceEnd: 2,
      replacement: "- a\n- ",
    });
  });

  test("a pure deletion borrows one character so undo stays reliable", () => {
    // H5 循环回 H1：从 "##### a" 删掉多余的 "#"，替换文本不能为空
    expect(range("##### a", 7, 7, "heading")).toEqual({
      replaceStart: 0,
      replaceEnd: 5,
      replacement: "#",
    });
  });

  test("a command that changes nothing reports no-op instead of an empty edit", () => {
    expect(edit("## title", 4, 4, { type: "setHeading", level: 2 })).toBeNull();
  });
});

describe("applyMarkdownCommand — native undo contract", () => {
  test("only the minimal range is replaced, never the whole document", () => {
    const textarea = makeTextarea("abc hello def", 4, 9);
    const frames: FrameRequestCallback[] = [];
    let selectionAtExec: number[] | null = null;

    const execCommand = vi.fn((_command: string, _ui: boolean, text: string) => {
      selectionAtExec = [textarea.selectionStart, textarea.selectionEnd];
      // 模拟真实 textarea：插入后光标落到替换文本末尾
      const start = textarea.selectionStart;
      textarea.value =
        textarea.value.slice(0, start) + text + textarea.value.slice(textarea.selectionEnd);
      const caret = start + text.length;
      textarea.setSelectionRange(caret, caret);
      textarea.scrollTop = 0;
      return true;
    });
    vi.stubGlobal("document", { execCommand });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });

    const setContent = vi.fn();
    const markDirty = vi.fn();
    const applied = applyMarkdownCommand(textarea, "bold", translate, setContent, markDirty);

    expect(applied).not.toBeNull();
    // 只替换选中那一段：既不是 [0, len]，也不是整篇内容
    expect(selectionAtExec).toEqual([4, 9]);
    expect(selectionAtExec).not.toEqual([0, "abc hello def".length]);
    expect(execCommand).toHaveBeenCalledTimes(1);
    expect(execCommand).toHaveBeenCalledWith("insertText", false, "**hello**");
    expect(setContent).toHaveBeenCalledWith("abc **hello** def");
    expect(markDirty).toHaveBeenCalledTimes(1);

    for (const callback of frames.splice(0)) callback(0);
    expect(textarea.selectionStart).toBe(6);
    expect(textarea.selectionEnd).toBe(11);
    // 视口在插入后会被带动，命令结束必须恢复
    expect(textarea.scrollTop).toBe(24);
  });

  test("a caret command inserts at the caret instead of selecting everything", () => {
    const textarea = makeTextarea("hello", 5, 5);
    let selectionAtExec: number[] | null = null;

    const execCommand = vi.fn((_command: string, _ui: boolean, text: string) => {
      selectionAtExec = [textarea.selectionStart, textarea.selectionEnd];
      textarea.value = textarea.value.slice(0, textarea.selectionStart) + text;
      return true;
    });
    vi.stubGlobal("document", { execCommand });
    vi.stubGlobal("requestAnimationFrame", () => 0);

    applyMarkdownCommand(textarea, "italic", translate, vi.fn(), vi.fn());

    expect(selectionAtExec).toEqual([5, 5]);
    expect(execCommand).toHaveBeenCalledWith("insertText", false, "*斜体文本*");
  });

  test("no-op commands never touch the DOM or the dirty state", () => {
    const { execCommand, setContent, markDirty } = stubEditorGlobals();
    const textarea = makeTextarea("## title", 4, 4);

    const result = applyMarkdownCommand(
      textarea,
      { type: "setHeading", level: 2 },
      translate,
      setContent,
      markDirty,
    );

    expect(result).toBeNull();
    expect(execCommand).not.toHaveBeenCalled();
    expect(setContent).not.toHaveBeenCalled();
    expect(markDirty).not.toHaveBeenCalled();
  });
});
