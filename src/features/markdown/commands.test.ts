import { afterEach, describe, expect, test, vi } from "vitest";
import { applyMarkdownCommand, computeMarkdownEdit, type MarkdownCommand } from "./commands";

function edit(value: string, start: number, end: number, command: MarkdownCommand) {
  return computeMarkdownEdit(value, start, end, command);
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

  test("bold without a selection inserts bare markers with the caret between them", () => {
    expect(edit("", 0, 0, "bold")).toEqual({
      result: "****",
      replaceStart: 0,
      replaceEnd: 0,
      replacement: "****",
      cursorStart: 2,
      cursorEnd: 2,
    });
  });

  test("italic wraps the selection", () => {
    expect(edit("hi", 0, 2, "italic")).toMatchObject({
      result: "*hi*",
      cursorStart: 1,
      cursorEnd: 3,
    });
  });

  test("italic without a selection inserts a bare pair", () => {
    expect(edit("", 0, 0, "italic")).toMatchObject({
      result: "**",
      cursorStart: 1,
      cursorEnd: 1,
    });
  });

  test("link wraps the selection and selects the url placeholder", () => {
    expect(edit("hi", 0, 2, "link")).toMatchObject({
      result: "[hi](url)",
      cursorStart: 5,
      cursorEnd: 8,
    });
  });

  test("link without a selection inserts an empty link with the caret in the brackets", () => {
    expect(edit("", 0, 0, "link")).toEqual({
      result: "[]()",
      replaceStart: 0,
      replaceEnd: 0,
      replacement: "[]()",
      cursorStart: 1,
      cursorEnd: 1,
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

  test("an empty line gets the marker only, no sample title", () => {
    expect(edit("", 0, 0, { type: "setHeading", level: 1 })).toMatchObject({
      result: "# ",
      cursorStart: 2,
      cursorEnd: 2,
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

  test("an empty line gains H2 without any sample text", () => {
    expect(edit("", 0, 0, "heading")).toEqual({
      result: "## ",
      replaceStart: 0,
      replaceEnd: 0,
      replacement: "## ",
      cursorStart: 3,
      cursorEnd: 3,
    });
  });
});

describe("computeMarkdownEdit — block actions", () => {
  test("unordered list without a selection inserts a bare marker", () => {
    expect(edit("", 0, 0, "ul")).toEqual({
      result: "- ",
      replaceStart: 0,
      replaceEnd: 0,
      replacement: "- ",
      cursorStart: 2,
      cursorEnd: 2,
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

  test("ordered list without a selection inserts a bare marker", () => {
    expect(edit("", 0, 0, "ol")).toMatchObject({
      result: "1. ",
      cursorStart: 3,
      cursorEnd: 3,
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

  test("quote and code without a selection insert bare markers", () => {
    expect(edit("", 0, 0, "quote")).toMatchObject({ result: "> ", cursorStart: 2, cursorEnd: 2 });
    expect(edit("", 0, 0, "code")).toMatchObject({ result: "``", cursorStart: 1, cursorEnd: 1 });
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
      replacement: "****",
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
    const applied = applyMarkdownCommand(textarea, "bold", setContent, markDirty);

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

    applyMarkdownCommand(textarea, "italic", vi.fn(), vi.fn());

    expect(selectionAtExec).toEqual([5, 5]);
    expect(execCommand).toHaveBeenCalledWith("insertText", false, "**");
  });

  test("no-op commands never touch the DOM or the dirty state", () => {
    const { execCommand, setContent, markDirty } = stubEditorGlobals();
    const textarea = makeTextarea("## title", 4, 4);

    const result = applyMarkdownCommand(
      textarea,
      { type: "setHeading", level: 2 },
      setContent,
      markDirty,
    );

    expect(result).toBeNull();
    expect(execCommand).not.toHaveBeenCalled();
    expect(setContent).not.toHaveBeenCalled();
    expect(markDirty).not.toHaveBeenCalled();
  });
});

describe("computeMarkdownEdit — M1.1 inline code", () => {
  test("wraps the selection in backticks and keeps it selected", () => {
    expect(edit("hello", 0, 5, "inlineCode")).toEqual({
      result: "`hello`",
      replaceStart: 0,
      replaceEnd: 5,
      replacement: "`hello`",
      cursorStart: 1,
      cursorEnd: 6,
    });
  });

  test("without a selection it inserts a bare backtick pair", () => {
    expect(edit("", 0, 0, "inlineCode")).toEqual({
      result: "``",
      replaceStart: 0,
      replaceEnd: 0,
      replacement: "``",
      cursorStart: 1,
      cursorEnd: 1,
    });
  });

  test("stays inline even when the selection spans lines", () => {
    // Toolbar 的 code action 会切成围栏代码块，inlineCode 不允许这样
    expect(edit("a\nb", 0, 3, "inlineCode")?.result).toBe("`a\nb`");
  });
});

describe("computeMarkdownEdit — M1.1 fenced code block", () => {
  test("wraps the selection in a fence and keeps it selected", () => {
    expect(edit("hello", 0, 5, "codeBlock")).toEqual({
      result: "```\nhello\n```",
      replaceStart: 0,
      replaceEnd: 5,
      replacement: "```\nhello\n```",
      cursorStart: 4,
      cursorEnd: 9,
    });
  });

  test("without a selection the caret lands inside the empty code area", () => {
    expect(edit("", 0, 0, "codeBlock")).toMatchObject({
      result: "```\n\n```",
      cursorStart: 4,
      cursorEnd: 4,
    });
  });

  test("adds the surrounding newline only when the fence would be glued to text", () => {
    expect(edit("abc", 3, 3, "codeBlock")?.result).toBe("abc\n```\n\n```");
    expect(edit("abc\n", 4, 4, "codeBlock")?.result).toBe("abc\n```\n\n```");
  });
});

describe("computeMarkdownEdit — M1.1 inline math", () => {
  test("wraps the selection and selects the formula", () => {
    expect(edit("E=mc^2", 0, 6, "inlineMath")).toEqual({
      result: "$E=mc^2$",
      replaceStart: 0,
      replaceEnd: 6,
      replacement: "$E=mc^2$",
      cursorStart: 1,
      cursorEnd: 7,
    });
  });

  test("without a selection it inserts a bare dollar pair", () => {
    expect(edit("", 0, 0, "inlineMath")).toEqual({
      result: "$$",
      replaceStart: 0,
      replaceEnd: 0,
      replacement: "$$",
      cursorStart: 1,
      cursorEnd: 1,
    });
  });
});

describe("computeMarkdownEdit — M1.1 block math", () => {
  test("wraps a whole-line selection into a display block", () => {
    expect(edit("E=mc^2", 0, 6, "blockMath")).toEqual({
      result: "$$\nE=mc^2\n$$",
      replaceStart: 0,
      replaceEnd: 6,
      replacement: "$$\nE=mc^2\n$$",
      cursorStart: 3,
      cursorEnd: 9,
    });
  });

  test("the $$ markers get their own lines when the caret sits mid-line", () => {
    // remark-math 只把行首的 $$ 当作块级公式，所以必须补前导换行
    expect(edit("abc", 3, 3, "blockMath")?.result).toBe("abc\n$$\n\n$$");
  });

  test("without a selection the caret is placed inside the empty block", () => {
    const applied = edit("", 0, 0, "blockMath");
    expect(applied?.result).toBe("$$\n\n$$");
    expect(applied?.cursorStart).toBe(3);
    expect(applied?.cursorEnd).toBe(3);
  });

  test("a block inserted between two paragraphs keeps them separated", () => {
    expect(edit("a\nb", 1, 1, "blockMath")?.result).toBe("a\n$$\n\n$$\nb");
  });
});

describe("computeMarkdownEdit — M1.1 table", () => {
  const TABLE = "|  |  |\n| --- | --- |\n|  |  |";

  test("inserts an empty 2x2 gfm table with a bare caret", () => {
    expect(edit("", 0, 0, "table")).toEqual({
      result: TABLE,
      replaceStart: 0,
      replaceEnd: 0,
      replacement: TABLE,
      cursorStart: 2,
      cursorEnd: 2,
    });
  });

  test("keeps the table on its own lines when inserted mid-text", () => {
    expect(edit("x", 1, 1, "table")?.result).toBe(`x\n${TABLE}`);
    expect(edit("x", 0, 0, "table")?.result).toBe(`${TABLE}\nx`);
  });

  test("the caret lands inside the first header cell", () => {
    const applied = edit("", 0, 0, "table");
    expect(applied?.cursorStart).toBe(2);
    expect(applied?.cursorEnd).toBe(2);
    // `|  |  |` 的前两个字符正是第一个单元格的空位
    expect(applied?.result.slice(0, applied.cursorStart)).toBe("| ");
  });

  test("the table carries no sample cells at all", () => {
    const applied = edit("", 0, 0, "table");
    expect(applied?.result).not.toContain("Header");
    expect(applied?.result).not.toContain("Cell");
  });
});

describe("applyMarkdownCommand — M1.1 keeps the native undo contract", () => {
  test("a table insertion replaces nothing and touches only the caret", () => {
    const { execCommand, setContent, markDirty } = stubEditorGlobals();
    const textarea = makeTextarea("abc", 3, 3);
    const ranges: number[][] = [];
    textarea.setSelectionRange = (start: number, end: number) => {
      ranges.push([start, end]);
      textarea.selectionStart = start;
      textarea.selectionEnd = end;
    };

    const applied = applyMarkdownCommand(textarea, "table", setContent, markDirty);

    expect(applied).not.toBeNull();
    expect(ranges[0]).toEqual([3, 3]);
    expect(execCommand).toHaveBeenCalledTimes(1);
    expect(setContent).toHaveBeenCalledTimes(1);
    expect(markDirty).toHaveBeenCalledTimes(1);
  });

  test("inline code only replaces the selected range", () => {
    const { execCommand } = stubEditorGlobals();
    const textarea = makeTextarea("abc hello def", 4, 9);
    const ranges: number[][] = [];
    textarea.setSelectionRange = (start: number, end: number) => {
      ranges.push([start, end]);
      textarea.selectionStart = start;
      textarea.selectionEnd = end;
    };

    applyMarkdownCommand(textarea, "inlineCode", vi.fn(), vi.fn());

    expect(ranges[0]).toEqual([4, 9]);
    expect(execCommand).toHaveBeenCalledWith("insertText", false, "`hello`");
  });
});

describe("no command invents sample content", () => {
  const commands: MarkdownCommand[] = [
    "bold",
    "italic",
    "link",
    "heading",
    "ul",
    "ol",
    "code",
    "quote",
    "inlineCode",
    "inlineMath",
    "blockMath",
    "codeBlock",
    "table",
  ];

  test.each(commands)("%s leaves no CJK placeholder behind", (command) => {
    const result = edit("", 0, 0, command);
    expect(result).not.toBeNull();
    expect(result?.result ?? "").not.toMatch(/[\u4e00-\u9fa5]/);
  });
});
