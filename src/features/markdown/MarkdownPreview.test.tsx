import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { computeMarkdownEdit } from "./commands";
import { MarkdownPreview } from "./MarkdownPreview";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

describe("MarkdownPreview", () => {
  test("marks rendered Markdown content as selectable", () => {
    const markup = renderToStaticMarkup(<MarkdownPreview content="# 花笺\n\n正文" />);

    expect(markup).toContain("markdown-selectable");
    expect(markup).toContain("<h1");
    expect(markup).toContain("花笺");
    expect(markup).toContain("正文");
  });

  test("keeps code block controls outside the horizontally scrollable pre", () => {
    const markup = renderToStaticMarkup(
      <MarkdownPreview content={"```text\nvery long code line\n```"} />,
    );

    const preCloseIndex = markup.indexOf("</pre>");
    const buttonIndex = markup.indexOf("<button");

    expect(markup).toContain("markdown-code-block");
    expect(markup).toContain("markdown-code-scroll");
    expect(preCloseIndex).toBeGreaterThan(-1);
    expect(buttonIndex).toBeGreaterThan(preCloseIndex);
  });
});

/**
 * M1.1：新增 command 的输出必须能被现有渲染器正确解析，
 * 否则"能插入但预览是乱码"就是最坏的结果。
 */
describe("MarkdownPreview — M1.1 command output", () => {
  /** 直接拿 command 的真实产物喂渲染器，避免测试字符串与实现漂移 */
  function commandOutput(command: Parameters<typeof computeMarkdownEdit>[3]): string {
    const edit = computeMarkdownEdit("", 0, 0, command);
    if (!edit) throw new Error(`command produced nothing: ${String(command)}`);
    return edit.result;
  }

  test("renders the empty 2x2 gfm table produced by the table command", () => {
    const table = commandOutput("table");
    const markup = renderToStaticMarkup(<MarkdownPreview content={table} />);

    // 空表头也必须被 GFM 识别成真表格，而不是一段竖线文本
    expect(markup).toContain("<table");
    expect(markup).toContain("<th");
    expect(markup).toContain("<td");
    expect(markup.match(/<th[\s>]/g)?.length).toBe(2);
    expect(markup).not.toContain("Header");
  });

  test("renders inline math through KaTeX", () => {
    const markup = renderToStaticMarkup(<MarkdownPreview content={"$E=mc^2$"} />);

    expect(markup).toContain("katex");
    // KaTeX 把源码拆成 <span>，不应原样留着 $...$
    expect(markup).not.toContain("$E=mc^2$");
  });

  test("renders a display math block through KaTeX", () => {
    const markup = renderToStaticMarkup(<MarkdownPreview content={"$$\nE=mc^2\n$$"} />);

    expect(markup).toContain("katex-display");
  });

  test("an empty display block inserted by the command renders without crashing", () => {
    // 无选区插入的是空块，用户还没输入公式时的中间状态
    const block = commandOutput("blockMath");
    expect(block).toBe("$$\n\n$$");

    const markup = renderToStaticMarkup(<MarkdownPreview content={block} />);
    expect(markup).toContain("markdown-selectable");
  });

  test("renders the fenced code block command output", () => {
    const markup = renderToStaticMarkup(<MarkdownPreview content={"```\nhello\n```"} />);

    expect(markup).toContain("<pre");
    expect(markup).toContain("hello");
  });

  test("an empty fenced block inserted by the command still renders as pre", () => {
    const fence = commandOutput("codeBlock");
    const markup = renderToStaticMarkup(<MarkdownPreview content={fence} />);

    expect(fence).toBe("```\n\n```");
    expect(markup).toContain("<pre");
  });
});
