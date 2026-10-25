/**
 * Markdown 编辑 command 层。
 *
 * Toolbar 按钮与键盘快捷键都只能经由 {@link applyMarkdownCommand} 修改编辑器内容，
 * 不允许各自实现一套字符串拼接逻辑。
 *
 * 无选区时的统一原则：**只插入最小合法 Markdown 结构，不生成任何示例文本**。
 * 早期实现会插入「粗体文本」「列表项」这类占位内容，但占位文字会被当成真实笔记内容，
 * 用户必须先删掉才能写 —— 现在所有成对标记都插成空壳（`****` / `**` / `` `` `` / `$$`），
 * 块级语法插成空块，光标直接落在可输入位置。`translate` 参数因此不再需要。
 *
 * Undo 语义：只替换最小编辑区间，并通过一次 `execCommand("insertText")` 应用，
 * 这样一次 Markdown 操作在 native textarea undo 栈里只对应一个条目，
 * `Ctrl+Z` 可以一次性撤销。**不要**改成 setContent() 或纯字符串 splice。
 */

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

/** 无参数 command：直接对应 Toolbar 按钮的 action。 */
export type MarkdownAction =
  | "bold"
  | "italic"
  /** 循环升级标题：H1→H2→…→H5→H1，保持上游 Toolbar 原有行为。 */
  | "heading"
  | "hr"
  | "ul"
  | "ol"
  /** Toolbar 的代码按钮：单行→行内代码，多行/跨行选区→围栏代码块 */
  | "code"
  | "quote"
  | "inlineMath"
  | "blockMath"
  /** 行内代码：无论选区是否跨行都只加一对反引号 */
  | "inlineCode"
  /** 围栏代码块：始终是 ``` 块 */
  | "codeBlock"
  /** 插入 2×2 GFM 表格并选中第一个表头单元格 */
  | "table"
  | "link";

/** 精确设置标题级别：`Ctrl+1`~`Ctrl+6`，同级再次执行是 no-op。 */
export interface SetHeadingCommand {
  type: "setHeading";
  level: HeadingLevel;
}

export type MarkdownCommand = MarkdownAction | SetHeadingCommand;

/**
 * 一次 command 的编辑结果。
 *
 * 除了最终内容，还要给出**最小替换区间**：只有这一段会被写进 native undo entry。
 * 早期实现是"整篇选中 + 整篇插入"，代价是 owner document 的 undo 会连同那次
 * 全选一起还原，`Ctrl+Z` 之后 textarea 停在整篇全选状态（R1 人工验收发现的真实问题）。
 */
export interface MarkdownEdit {
  /** 应用后的完整内容，用于 setContent */
  result: string;
  /** 被替换区间起点（含） */
  replaceStart: number;
  /** 被替换区间终点（不含） */
  replaceEnd: number;
  /** 替换文本（落在 [replaceStart, replaceEnd) 上） */
  replacement: string;
  cursorStart: number;
  cursorEnd: number;
}

/**
 * 由前后两份内容求出最小替换区间（公共前缀 + 公共后缀裁剪）。
 *
 * 这样一次 bold 只替换被包裹的那几个字符，而不是整篇：
 * undo 时 WebView2 恢复的选区自然就是这一小段，不会变成全选。
 */
function minimalEdit(
  value: string,
  result: string,
): Pick<MarkdownEdit, "replaceStart" | "replaceEnd" | "replacement"> {
  const maxPrefix = Math.min(value.length, result.length);
  let prefix = 0;
  while (prefix < maxPrefix && value[prefix] === result[prefix]) prefix += 1;

  const maxSuffix = Math.min(value.length - prefix, result.length - prefix);
  let suffix = 0;
  while (
    suffix < maxSuffix &&
    value[value.length - 1 - suffix] === result[result.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const replaceStart = prefix;
  const replaceEnd = value.length - suffix;
  const replacement = result.slice(prefix, result.length - suffix);

  // 极少数 command 会是纯删除（例如 H5 循环回 H1 要删掉多余的 `#`）。
  // `execCommand("insertText", "", …)` 在 WebView2 上不保证记录 undo entry，
  // 所以向左借一个字符一起替换，保证 replacement 永远非空。
  if (replacement === "" && replaceStart < replaceEnd) {
    if (replaceStart > 0) {
      return { replaceStart: replaceStart - 1, replaceEnd, replacement: value[replaceStart - 1] };
    }
    if (replaceEnd < value.length) {
      return { replaceStart, replaceEnd: replaceEnd + 1, replacement: value[replaceEnd] };
    }
  }

  return { replaceStart, replaceEnd, replacement };
}

export function isSetHeadingCommand(command: MarkdownCommand): command is SetHeadingCommand {
  return typeof command === "object" && command !== null && command.type === "setHeading";
}

function headingPrefix(level: number): string {
  return `${"#".repeat(level)} `;
}

/**
 * 块级插入的前后换行。
 *
 * 块级语法（`$$` / ``` / 表格）必须独占行首行尾，否则会被当成上一段正文的一部分。
 * 只在**需要**时补一个换行：光标本来就在行首 / 行尾时不再多插空行，
 * 这样 `E=mc^2` 整行选中后得到的就是 `$$\nE=mc^2\n$$`。
 */
function blockPadding(before: string, after: string): { lead: string; trail: string } {
  return {
    lead: before === "" || before.endsWith("\n") ? "" : "\n",
    trail: after === "" || after.startsWith("\n") ? "" : "\n",
  };
}

/**
 * 纯函数：给定内容与选区，算出新内容与执行后的光标位置。
 * 返回 `null` 表示该 command 在当前状态下是 no-op（例如标题级别已相同）。
 */
export function computeMarkdownEdit(
  value: string,
  start: number,
  end: number,
  command: MarkdownCommand,
): MarkdownEdit | null {
  const selected = value.slice(start, end);
  const before = value.slice(0, start);
  const after = value.slice(end);

  const lineStart = before.lastIndexOf("\n") + 1;
  // Toolbar 的 heading 循环沿用上游语义：只看光标之前的行内文本
  const linePrefix = before.slice(lineStart);
  // 精确标题要判断整行（含光标之后），否则光标落在行首时会漏判已有标题记号
  const lineEnd = value.indexOf("\n", start);
  const fullLine = value.slice(lineStart, lineEnd === -1 ? value.length : lineEnd);

  let result: string;
  let cursorStart: number;
  let cursorEnd: number;

  if (isSetHeadingCommand(command)) {
    const level = command.level;
    const prefix = headingPrefix(level);
    const existing = fullLine.match(/^(#{1,6})\s/);

    if (existing) {
      // 已经是目标级别：no-op，不 toggle 回正文
      if (existing[1].length === level) return null;
      const beforeLine = value.slice(0, lineStart);
      const afterPrefix = value.slice(lineStart + existing[0].length);
      result = beforeLine + prefix + afterPrefix;
      const offset = prefix.length - existing[0].length;
      // 光标落在标题记号内部时（理论上少见）不能跑到 lineStart 之前
      cursorStart = Math.max(lineStart + prefix.length, start + offset);
      cursorEnd = Math.max(cursorStart, end + offset);
    } else {
      // 当前行没有标题记号：在行首插入
      result = value.slice(0, lineStart) + prefix + value.slice(lineStart);
      cursorStart = start + prefix.length;
      cursorEnd = end + prefix.length;
    }
  } else {
    switch (command) {
      case "bold": {
        result = `${before}**${selected}**${after}`;
        cursorStart = start + 2;
        cursorEnd = cursorStart + selected.length;
        break;
      }
      case "italic": {
        result = `${before}*${selected}*${after}`;
        cursorStart = start + 1;
        cursorEnd = cursorStart + selected.length;
        break;
      }
      case "link": {
        if (selected) {
          result = `${before}[${selected}](url)${after}`;
          // 把 url 占位选中，直接输入或粘贴即可替换
          cursorStart = start + selected.length + 3;
          cursorEnd = cursorStart + 3;
        } else {
          // 无选区：只有 `[]()` 骨架，光标停在方括号内
          result = `${before}[]()${after}`;
          cursorStart = cursorEnd = start + 1;
        }
        break;
      }
      case "heading": {
        const prefix = linePrefix.match(/^(#{1,5})\s/);
        if (prefix) {
          const newLevel = prefix[1].length < 5 ? "#".repeat(prefix[1].length + 1) : "#";
          const beforeLine = value.slice(0, lineStart);
          const afterPrefix = value.slice(lineStart + prefix[0].length);
          result = beforeLine + newLevel + " " + afterPrefix;
          const offset = newLevel.length + 1 - prefix[0].length;
          cursorStart = start + offset;
          cursorEnd = end + offset;
        } else if (linePrefix.length > 0 && start === end) {
          result = value.slice(0, lineStart) + "## " + value.slice(lineStart);
          cursorStart = start + 3;
          cursorEnd = cursorStart;
        } else if (selected) {
          result = before + `## ${selected}` + after;
          cursorStart = start + 3;
          cursorEnd = cursorStart + selected.length;
        } else {
          // 无选区：只补标题记号，光标在记号之后
          result = `${before}## ${after}`;
          cursorStart = cursorEnd = start + 3;
        }
        break;
      }
      case "hr": {
        const newlineBefore = before.endsWith("\n") || before === "" ? "" : "\n";
        const newlineAfter = after.startsWith("\n") || after === "" ? "" : "\n";
        result = before + `${newlineBefore}---${newlineAfter}` + after;
        cursorStart = cursorEnd = before.length + newlineBefore.length + 3;
        break;
      }
      case "ul": {
        if (selected.includes("\n")) {
          const lines = selected
            .split("\n")
            .map((l) => `- ${l}`)
            .join("\n");
          result = before + lines + after;
          cursorStart = start;
          cursorEnd = start + lines.length;
        } else {
          result = `${before}- ${selected}${after}`;
          cursorStart = start + 2;
          cursorEnd = cursorStart + selected.length;
        }
        break;
      }
      case "ol": {
        if (selected.includes("\n")) {
          const lines = selected
            .split("\n")
            .map((l, i) => `${i + 1}. ${l}`)
            .join("\n");
          result = before + lines + after;
          cursorStart = start;
          cursorEnd = start + lines.length;
        } else {
          result = `${before}1. ${selected}${after}`;
          cursorStart = start + 3;
          cursorEnd = cursorStart + selected.length;
        }
        break;
      }
      case "code": {
        if (selected.includes("\n")) {
          const wrapped = "```\n" + selected + "\n```";
          result = before + wrapped + after;
          cursorStart = start + 4;
          cursorEnd = cursorStart + selected.length;
        } else {
          result = `${before}\`${selected}\`${after}`;
          cursorStart = start + 1;
          cursorEnd = cursorStart + selected.length;
        }
        break;
      }
      case "quote": {
        if (selected.includes("\n")) {
          const lines = selected
            .split("\n")
            .map((l) => `> ${l}`)
            .join("\n");
          result = before + lines + after;
          cursorStart = start;
          cursorEnd = start + lines.length;
        } else {
          result = `${before}> ${selected}${after}`;
          cursorStart = start + 2;
          cursorEnd = cursorStart + selected.length;
        }
        break;
      }
      case "inlineMath": {
        result = `${before}$${selected}$${after}`;
        cursorStart = start + 1;
        cursorEnd = cursorStart + selected.length;
        break;
      }
      case "blockMath": {
        const { lead, trail } = blockPadding(before, after);
        result = `${before}${lead}$$\n${selected}\n$$${trail}${after}`;
        // 光标落在 `$$` 之后、公式正文之前
        cursorStart = start + lead.length + 3;
        cursorEnd = cursorStart + selected.length;
        break;
      }
      case "inlineCode": {
        result = `${before}\`${selected}\`${after}`;
        cursorStart = start + 1;
        cursorEnd = cursorStart + selected.length;
        break;
      }
      case "codeBlock": {
        const { lead, trail } = blockPadding(before, after);
        // 无选区时留空正文，光标直接停在可以输入代码的那一行
        result = `${before}${lead}\`\`\`\n${selected}\n\`\`\`${trail}${after}`;
        cursorStart = start + lead.length + 4;
        cursorEnd = cursorStart + selected.length;
        break;
      }
      case "table": {
        const { lead, trail } = blockPadding(before, after);
        // 空 2×2 GFM 表：只有结构，不含任何示例文本
        result = `${before}${lead}|  |  |\n| --- | --- |\n|  |  |${trail}${after}`;
        // 光标落在第一个表头单元格内
        cursorStart = cursorEnd = start + lead.length + 2;
        break;
      }
    }
  }

  // 内容没有变化就没有可撤销的东西，也不要制造空的 undo entry
  if (result === value) return null;

  return { result, ...minimalEdit(value, result), cursorStart, cursorEnd };
}

/**
 * 把 command 应用到真实 textarea 上。返回 `null` 表示该 command 是 no-op，
 * DOM 与回调都不会被触碰。
 *
 * 只替换最小编辑区间：native undo entry 覆盖的范围就是这一小段，
 * `Ctrl+Z` 恢复内容时不会连带把整篇 textarea 变成全选。
 */
export function applyMarkdownCommand(
  textarea: HTMLTextAreaElement,
  command: MarkdownCommand,
  setContent: (value: string) => void,
  markDirty: () => void,
): MarkdownEdit | null {
  const { selectionStart: start, selectionEnd: end, value } = textarea;
  const edit = computeMarkdownEdit(value, start, end, command);
  if (!edit) return null;

  const { result, replaceStart, replaceEnd, replacement, cursorStart, cursorEnd } = edit;

  const previousScrollTop = textarea.scrollTop;
  textarea.focus();
  // 只选中真正要改的那一段：这是 undo 选区不再全选的关键
  textarea.setSelectionRange(replaceStart, replaceEnd);
  document.execCommand("insertText", false, replacement);
  setContent(result);
  markDirty();
  requestAnimationFrame(() => {
    textarea.setSelectionRange(cursorStart, cursorEnd);
    textarea.scrollTop = previousScrollTop;
  });
  return edit;
}
