# M1 Markdown Shortcuts

> **STATUS: CLOSED**
>
> | 阶段                            | 状态             |
> | ------------------------------- | ---------------- |
> | M1 Markdown Shortcuts           | **CLOSURE PASS** |
> | M1.1 Extended Markdown Commands | **CLOSURE PASS** |
> | 人工验收                        | **PASS**         |
>
> 收口记录见 §14；提交为 `feat(editor): complete markdown editing shortcuts`。
> Live Preview（M0 原型）已完整回退，**不属于本次提交**，
> 技术结论单独留在 `LIVE_PREVIEW_M0.md`（`PROTOTYPE VALIDATED / DEFERRED`）。
>
> 阶段范围：仅 Markdown 编辑快捷键。
> 不涉及 M2 Storage、不修改 notes 存储、不动 updater、未做无关重构。
>
> **R2 已修订本文件的 §4 / §5 / §9**：
>
> - R1 的"整篇选中 + 整篇插入"写法在 WebView2 上有 undo 选区副作用（§12.1 已修）
> - 快捷键改为配置驱动，并通过 Settings 面板编辑（§12.2）
> - R2 为持久化快捷键，给 Rust `AppConfig` 增加了一个 `#[serde(default)]` 字段（§12.2.3），
>   这是 R2 中**唯一**的 Rust 改动，不涉及 notes 存储语义。

## 1. 结论

Toolbar 的格式逻辑已从 `MainWindow.tsx` 抽出到 `src/features/markdown/commands.ts`，
Toolbar 与快捷键调用**同一个** `applyMarkdownCommand()`，不存在两套实现。
MainWindow 与 NotePad 各自通过 `useMarkdownShortcuts()` 在本 WebView 内注册 document 监听，
未使用 Rust global shortcut。

R1 的 PASS 在人工验收中被推翻（undo 后 textarea 全选），R2 修复并重测，
最终结论见 §12.7；M1.1 在其上扩展 5 个 command，结论见 §13；两者合并收口见 §14。

**M1: CLOSURE PASS**
**M1.1: CLOSURE PASS**

## 2. 修改文件

### 新增

| 文件                                                 | 行数 | 职责                                      |
| ---------------------------------------------------- | ---- | ----------------------------------------- |
| `src/features/markdown/commands.ts`                  | 281  | 统一 Markdown command：纯计算 + DOM 应用  |
| `src/features/markdown/shortcuts.ts`                 | 66   | 纯 `KeyboardEvent → MarkdownCommand` 映射 |
| `src/features/markdown/useMarkdownShortcuts.ts`      | 91   | 事件处理器工厂 + React hook 注册          |
| `src/features/markdown/commands.test.ts`             | 296  | command 层测试（23）                      |
| `src/features/markdown/shortcuts.test.ts`            | 99   | 映射表测试（20）                          |
| `src/features/markdown/useMarkdownShortcuts.test.ts` | 202  | 处理器边界测试（7）                       |

### 修改

| 文件                                               | 改动                                                                                                                                                                    | 性质                  |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `src/components/MainWindow.tsx`                    | 删除本地 `FormatAction` / `applyFormat`（原 124–304 行），改为 import `applyMarkdownCommand`；Toolbar `action` 类型换成 `MarkdownAction`；在 `markDirty` 之后注册快捷键 | 搬移，无逻辑重写      |
| `src/components/NotePad.tsx`                       | 新增 `markContentDirty` 与 `useMarkdownShortcuts` 调用（第 435–447 行）                                                                                                 | 新增接入              |
| `src/locales/{zh-CN,en-US,zh-HK}/translation.json` | 新增 `main.formatSample.linkText`                                                                                                                                       | i18n 键（三语言齐平） |

`runEditorCommand()`（undo/redo）保留在 `MainWindow.tsx` 原位，未搬动、未改动。

## 3. Command 架构

```
Toolbar 按钮 (MainWindow.tsx)
        │
        └──────────────┐
                       ▼
            applyMarkdownCommand(textarea, command, setContent, markDirty)
                       ▲
        ┌──────────────┘
document keydown (useMarkdownShortcuts.ts)
        │  resolveMarkdownShortcut(event, bindings) → MarkdownCommand | null
        ▼
computeMarkdownEdit(value, start, end, command)                      (commands.ts)
        ▼
{ result, replaceStart, replaceEnd, replacement, cursorStart, cursorEnd } | null
        ▼
setSelectionRange(replaceStart, replaceEnd) → execCommand("insertText", false, replacement)
```

三层职责与文件一一对应：

- `commands.ts`：`MarkdownAction`（无参数 command，也就是 Toolbar 的按钮）+ `SetHeadingCommand`（`{ type: "setHeading", level }`）。`computeMarkdownEdit()` 是纯函数（无 DOM），`applyMarkdownCommand()` 只负责应用。返回 `null` 表示 no-op，此时 DOM、`setContent`、`markDirty` 都不会被触碰。
- `shortcuts.ts`：只有映射，不读 textarea、不调 `preventDefault`，可直接用普通对象测试。
- `useMarkdownShortcuts.ts`：`createMarkdownShortcutHandler()` 与 React 解耦（可测），`useMarkdownShortcuts()` 只做一次 `document.addEventListener("keydown")`，用 ref 持有最新回调，避免每次输入重绑。

Toolbar 的 `heading` 循环行为逐字保留，`setHeading` 是独立分支，两者互不影响。
command 层不产生任何示例文本，因此也不再依赖 i18n（`translate` 参数已于 M1.1 收口时移除）。

## 4. Shortcut mapping

> R2 起这张表只是**默认值**，实际生效的绑定来自 Settings（§12.2）；
> M1.1 新增 7 个 action，**最终默认表以 §13.6 为准**，下表与之一致。

| 按键                | Command                         | 说明                                                                    |
| ------------------- | ------------------------------- | ----------------------------------------------------------------------- |
| `Ctrl+B`            | `bold`                          | 有选区包裹选区；无选区插入本地化示例文本                                |
| `Ctrl+I`            | `italic`                        | 同上                                                                    |
| `Ctrl+K`            | `link`                          | `[文本](url)`，生成后**选中 `url` 占位符**，直接输入/粘贴即可替换       |
| `Ctrl+1` … `Ctrl+6` | `{ type: "setHeading", level }` | 精确设置，已是同级则 **no-op**                                          |
| `Ctrl+Shift+1`      | `ul`                            | 数字键用 `event.code === "Digit1"` 判定，Shift 后 `key` 变 `!` 也能命中 |
| `Ctrl+Shift+2`      | `ol`                            | 同上（`Digit2` / `@`）                                                  |
| `Ctrl+Shift+Q`      | `inlineCode`                    | 行内代码                                                                |
| `Ctrl+Shift+W`      | `codeBlock`                     | 围栏代码块                                                              |
| `Ctrl+Shift+A`      | `blockMath`                     | `$$` 块级公式（避开原生 Redo，见 §13.2）                                |
| `Ctrl+Shift+S`      | `inlineMath`                    | `$…$` 行内公式                                                          |
| `Ctrl+Shift+B`      | `table`                         | 2×2 GFM 表格，选中 `Header 1`                                           |

其余一律返回 `null`，不 `preventDefault`：
`Ctrl+Z / Ctrl+Y / Ctrl+S / Ctrl+A / Ctrl+C / Ctrl+V / Ctrl+X / Tab / Escape / 裸字母 / AltGr(Alt+…)`。

附加兼容：

- `Cmd`（`metaKey`）等价于 `Ctrl`，沿用仓库既有 `ctrlKey || metaKey` 约定（`MainWindow.tsx` 的 Ctrl+S 同款）。
- 非拉丁键盘布局下 `event.key` 不是 `b` 时，回退按物理键 `event.code === "KeyB"` 命中。
- 小键盘 `Numpad3` 与主键盘 `Digit3` 等价（`Ctrl+3`）。
- 标题键位只在**无 Shift** 时生效，所以 `Ctrl+Shift+1` 不会被误判成 H1 —— 它是无序列表。

## 5. Undo 保持方式

> **R1 写法已被 R2-A 推翻。** 本节保留是为了记录"为什么当初这么写"；
> 现行为见 §12.1：仍是一次 native `execCommand("insertText")`，但只替换最小编辑区间。

`applyMarkdownCommand()` 原样保留上游的三步（R1 版本，`commands.ts` 旧实现）：

```ts
const previousScrollTop = textarea.scrollTop;
textarea.focus();
textarea.setSelectionRange(0, value.length); // 整篇选中
document.execCommand("insertText", false, result); // 一次插入，一个 undo 条目
setContent(result);
markDirty();
requestAnimationFrame(() => {
  // 恢复选区与视口
  textarea.setSelectionRange(cursorStart, cursorEnd);
  textarea.scrollTop = previousScrollTop;
});
```

没有改成 `setContent()` 直写，也没有做字符串 splice 后手动赋值 —— 那会让 native undo 栈丢掉这一步，
`Ctrl+Z` 退化为"整篇回滚"或完全失效。

`commands.test.ts` 用一个记录调用的 `execCommand` 桩断言了三件事：
调用次数恒为 1、参数恒为 `("insertText", false, 完整新内容)`、调用瞬间 textarea 处于 `[0, value.length]` 全选状态。
（R2-A 之后这三条断言中的"全选"一项已改为"最小区间"，见 §12.1。）
另有一个测试断言 rAF 阶段选区被设回 `cursorStart/cursorEnd`、`scrollTop` 恢复原值。

一次 command 的副作用顺序：`execCommand`（原生 input 事件 → React onChange）→ `setContent`（同值，React 不重写 DOM）→ `markDirty`（触发 900ms 防抖保存）。
因为 React 拿到的 value 与 DOM 现值相同，重渲染不会重置选区，这是这套写法能成立的前提，也是搬移时不敢动它的原因。

## 6. IME 保护

```ts
// shortcuts.ts:38
export function isImeComposing(event) {
  return Boolean(event.isComposing) || event.keyCode === 229;
}
```

`resolveMarkdownShortcut()` 第一行即返回 `null`（`shortcuts.ts:43`），所以组合态期间不会 `preventDefault`、不会触发 command。
两个条件都保留：`isComposing` 是现代标准，`keyCode === 229` 覆盖部分 IME / WebView 的 legacy 上报。

测试覆盖：`isComposing: true` 时 `Ctrl+B` / `Ctrl+1` 均返回 `null`；`keyCode: 229` 同理；处理器层再验证一次"组合态不 preventDefault、不调 execCommand"。

## 7. 精确标题 vs 循环标题

|            | Toolbar `H` 按钮                         | `Ctrl+1`~`Ctrl+6`               |
| ---------- | ---------------------------------------- | ------------------------------- |
| command    | `"heading"`                              | `{ type: "setHeading", level }` |
| 语义       | 循环升级 H1→H2→…→H5→H1                   | 精确设置                        |
| 已是同级   | 继续升级                                 | **no-op**（不 toggle 回正文）   |
| 判定行文本 | 光标**之前**的行内文本（上游语义，未改） | 整行（含光标之后）              |

`setHeading` 之所以用整行判定：光标可能停在行首（`Ctrl+1` 前用 `Home` 归位），
只截光标之前的内容会得到空串，从而漏判已有 `# ` 前缀并叠成 `"# # title"`。
Toolbar 的 `heading` 仍用旧判定，行为与上游逐字一致。

## 8. 测试与构建结果

### 测试

```
新增：3 文件 / 50 用例  全部通过
全量：27 文件 / 160 用例 全部通过（vitest run，1.97s）
```

| 验证项                      | 覆盖方式                                                                  | 结果                       |
| --------------------------- | ------------------------------------------------------------------------- | -------------------------- |
| Bold 有选区                 | `commands.test.ts` 期望 `**hello**`、光标 2–7                             | PASS                       |
| Bold 无选区                 | 期望 `**粗体文本**`、光标 2–6                                             | PASS                       |
| Italic 有/无选区            | `*hi*`、`*斜体文本*`                                                      | PASS                       |
| Link 有选区                 | `[hi](url)`，光标选中 `url`（5–8）                                        | PASS                       |
| Link 无选区                 | `[链接文本](url)`                                                         | PASS                       |
| H1 / H3 / H6 exact          | 空行加前缀、改级不叠加、H6 可被识别                                       | PASS                       |
| 同级 heading no-op          | 返回 `null`，且不触碰 DOM / dirty                                         | PASS                       |
| H6 → H2                     | `###### h` → `## h`                                                       | PASS                       |
| 多行中只改光标所在行        | `a\nb` → `a\n## b`                                                        | PASS                       |
| Ordered / Unordered List    | 单行 + 多行逐行加前缀                                                     | PASS                       |
| Toolbar heading 循环无回归  | H1→H2、H5→H1、普通行→H2                                                   | PASS                       |
| 其余 Toolbar command 无回归 | hr / quote / code 形状断言                                                | PASS                       |
| IME composition 不误触发    | `isComposing`、`keyCode 229`                                              | PASS                       |
| 基础键不被劫持              | Ctrl+Z/Y/S/A/C/V/X、Tab、Escape、裸字母、Alt 组合                         | PASS                       |
| 一次性 undo                 | execCommand 调用次数 = 1、整篇选中后插入                                  | PASS（结构断言）           |
| MainWindow 接入口径         | 与 hook 共用 `createMarkdownShortcutHandler`（目标过滤/派发路径同一实现） | PASS（分派层）+ 需人工确认 |
| NotePad 接入口径            | 同上                                                                      | PASS（分派层）+ 需人工确认 |

"MainWindow / NotePad shortcuts" 的**分发路径**由 `createMarkdownShortcutHandler` 测试覆盖；
两个组件的差别只有"传入哪个 textarea ref、哪个 setContent"，已通过类型检查与代码审查确认。
真实按键回放需要 jsdom（本仓库未安装），未据此新增依赖。

### 构建

| 命令                                 | 结果                                                                                    |
| ------------------------------------ | --------------------------------------------------------------------------------------- |
| `npx tsc --noEmit`                   | PASS（无输出）                                                                          |
| `npx oxlint`（5 个改动源文件）       | PASS，0 warnings / 0 errors                                                             |
| `npx oxfmt --check`（8 个改动文件）  | PASS（已格式化）                                                                        |
| `npx vite build --outDir <临时目录>` | PASS，698ms，产物与基线一致（`index-*.js` 226.45 kB、`MarkdownPreview-*.js` 330.80 kB） |
| `npm run build`（原地写 `dist/`）    | **被沙箱拦截**：vite 清空 `dist/assets` 触发批量删除确认，权限请求被拒绝                |

最后一项不是代码问题：`npm run build` = `fetch-contributors && tsc && vite build`，
前两步等价命令已分别 PASS，第三步用临时 outDir 跑通了同一份产物。
需要原地生成 `dist/` 时，请批准一次"清空 `dist/assets`"（构建产物目录），或直接告诉我，我再执行。

## 9. 已知限制

1. `Ctrl+1`~`Ctrl+6` 作用于**选区起始行**；多行选区不会逐行设置标题（列表 command 才逐行处理）。Typora 是逐行，这里未扩展，避免超出本阶段范围。
2. Toolbar `H` 循环在光标位于行首（`#` 之前）时仍会追加前缀。这是上游既有语义，本轮按要求"保持不变"，未修。
3. Toolbar `H` 循环对 H6（`###### `）不匹配 `^(#{1,5})\s`，会落到"普通行"分支追加 `## `。上游既有行为，未动。
4. Link 的 `url` 占位符不做本地化（三语言都是 `url`），因为它是占位内容而非文案，且生成后立刻被选中。
5. 快捷键只在目标 textarea 聚焦时生效：NotePad 标题输入框、Tile 磁贴视图、Preview 模式（textarea 未挂载）都不响应。
6. 未纳入本阶段的 Typora 组合：`Ctrl+Shift+B`（引用，该键 M1.1 已用作表格）、`Ctrl+Shift+\``（行内代码，已由 `Ctrl+Shift+Q` 覆盖）、`Ctrl+Shift+K`（删除线）。
7. 若输入法在 composition **之外**注册并吞掉 `Ctrl+B` 这类组合（少见），应用仍会接管；IME 保护只覆盖组合态。
8. 未安装 jsdom / testing-library，因此"真实 DOM 回放 Ctrl+Z"与"真实 IME 组合"没有自动化用例，靠结构断言 + 人工验收。

## 10. 人工验收清单（建议在应用中确认一次）

1. MainWindow：选中文本 `Ctrl+B` → 加粗；`Ctrl+Z` 一次撤销回原状（不是退两次，也不是整篇回滚）。
2. MainWindow：光标在 `## 标题` 行按 `Ctrl+2` → 无变化（no-op）；按 `Ctrl+4` → 变成 `#### 标题`；Toolbar `H` 仍是循环升级。
3. MainWindow：`Ctrl+Shift+1` 多行选区 → 每行加 `- `（M1.1 前是 `Ctrl+Shift+8`）。
4. NotePad：同一组快捷键生效；焦点在**标题输入框**时按 `Ctrl+B` 不受影响。
5. 中文输入法：拼音候选框展开期间按 `Ctrl+B`，只应影响候选框，不产生 `**`。
6. Split / Preview 模式切换后，快捷键只在 Edit 侧 textarea 生效。

## 11. 后续（不在本阶段）

- 若需要 Typora 的"多行逐行设置标题"，在 `commands.ts` 的 `setHeading` 分支扩展，Toolbar 与快捷键自动同时生效。
- 若要给 Toolbar 补 Link 按钮，直接把 `"link"` 加进 `toolbarButtons`，无需新增逻辑。

---

## 12. R2：Undo 选区修复 + 可配置快捷键

R2 由 R1 的人工验收驱动：功能都在，但 `Ctrl+Z` 会把 textarea 留在整篇全选状态。
本章记录审计结论、修复方式与新增的快捷键配置能力。

### 12.1 R2-A：native undo 的选区副作用

#### 12.1.1 审计：全选是怎么来的

R1 的 `applyMarkdownCommand()` 为了"一次操作只产生一个 undo entry"，做了整篇替换：

```ts
textarea.setSelectionRange(0, value.length); // 整篇选中
document.execCommand("insertText", false, result); // 一次插入
```

WebView2 / Chromium 的 undo entry 记的是「被替换的区间 + 替换时的那段选区」。
整篇替换意味着这条 undo entry 关联的选区就是 `[0, len]`，所以 `Ctrl+Z` 还原内容的同时还原了全选。
**这不是 React 的问题**：DOM 的 selection 由原生 undo 直接恢复，React 只在 `value` 不一致时写 DOM，
从不修正 selection（`commands.ts` 里只有 rAF 里那一次 `setSelectionRange`，而它不会在 undo 时执行）。

#### 12.1.2 为什么不引入 JS undo stack

- 需求是"一次 command = 一次 Ctrl+Z"，native 已经满足，差的只是**替换范围**。
- 自建 history 要接管 `onChange`、图片粘贴、外部文件载入、undo/redo 快捷键，并自己维护 redo 栈；
  一旦漏掉一条写入路径就会出现"改过的内容撤销不回去"，风险远大于收益。
- 结论：**不引入 JS undo history**，只把替换范围收窄。唯一新增的 JS 逻辑是 §12.1.4 的选区兜底，
  它不保存任何历史、也不接管 undo 本身。

#### 12.1.3 改法：最小编辑区间

`MarkdownEdit` 从 `{ result, cursorStart, cursorEnd }` 变为带上编辑区间：

```ts
export interface MarkdownEdit {
  result: string; // 应用后的完整内容（setContent 用）
  replaceStart: number; // 被替换区间起点
  replaceEnd: number; // 被替换区间终点
  replacement: string; // 落在 [replaceStart, replaceEnd) 上的文本
  cursorStart: number;
  cursorEnd: number;
}
```

`minimalEdit()`（`commands.ts:65`）用"公共前缀 + 公共后缀裁剪"求区间，`applyMarkdownCommand()` 只做：

```ts
textarea.setSelectionRange(replaceStart, replaceEnd); // 只选中真正要改的那一段
document.execCommand("insertText", false, replacement); // 仍然只有一次 → 仍然只有一个 undo entry
```

两个必须处理的边界：

| 边界                               | 处理                                             | 原因                                                                                                            |
| ---------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| 纯删除（如 H5 循环回 H1 要删 `#`） | 向相邻借一个字符一起替换，`replacement` 永不为空 | `execCommand("insertText", "", …)` 在 WebView2 上不保证记录 undo entry；空替换会让"撤销"丢步或状态与 DOM 不一致 |
| `result === value`                 | `computeMarkdownEdit` 直接返回 `null`            | 不制造空 undo entry                                                                                             |

各 command 的实际区间（`commands.test.ts` 已断言）：

| 场景              | 内容                        | 区间     | replacement    |
| ----------------- | --------------------------- | -------- | -------------- |
| Bold 有选区       | `abc hello def`，选 `hello` | `[4, 9)` | `**hello**`    |
| Bold 无选区       | 空文档                      | `[0, 0)` | `**粗体文本**` |
| Link              | `abc hi def`，选 `hi`       | `[4, 6)` | `[hi](url)`    |
| 标题升级          | `# text` → H3               | `[1, 1)` | `##`           |
| Toolbar 循环      | `## a` → H3                 | `[2, 2)` | `#`            |
| H5 → H1（纯删除） | `##### a`                   | `[0, 5)` | `#`            |
| 无序列表          | `a\nb` 全选                 | `[0, 2)` | `- a\n- `      |

#### 12.1.4 undo 之后的光标

收窄区间后，native undo 恢复的选区就是那一小段：

- **Bold 有选区**：undo 后原来的 `hello` 仍被选中 —— 正是用户格式化前的选区。
- **Bold 无选区**：undo 后光标回到插入点。
- **标题改级**：只涉及 `#` 标记，undo 后光标落在标记处。
- **列表**：undo 后选中被加前缀的那几行。

再加一层兜底 `createUndoSelectionGuard()`（`useMarkdownShortcuts.ts`）：
只在 `inputType === "historyUndo" | "historyRedo"` **且当前是整篇全选**时，
把光标收回到上一次 command 的 `replaceStart`。
作用是覆盖"用户全选全文 → 格式化 → undo"这种区间本身就等于全文的情形，保证
**textarea 永远不会停在全选状态**。它不监听 `Ctrl+Z`、不存历史、不改 redo 行为。

### 12.2 R2-B：可配置快捷键

#### 12.2.1 绑定模型（`src/features/markdown/shortcutBindings.ts`）

绑定 = 一个可序列化字符串（`Ctrl+B` / `Ctrl+Shift+1`），同时用于持久化、显示与匹配。

| 能力          | 函数                                                | 规则                                                                                                                      |
| ------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 解析 / 归一化 | `parseMarkdownBinding` / `normalizeMarkdownBinding` | 修饰键大小写不敏感；字母统一大写；`Ctrl/Control`、`Meta/Command/Cmd` 同义                                                 |
| 显示          | `formatMarkdownBinding`                             | `Ctrl + Shift + 1`                                                                                                        |
| 捕获          | `bindingFromShortcutEvent`                          | 字母/数字走 `event.code`（布局无关），符号走 `event.key`；返回 ok / modifierOnly / needsModifier / reserved / unsupported |
| 冲突          | `findShortcutConflict`                              | 同一条绑定被两个 action 占用                                                                                              |
| 合并          | `resolveMarkdownShortcutBindings`                   | 默认表 + 合法覆盖；非法/保留/重复的覆盖回落默认，永远输出一套可用且无冲突的绑定                                           |

映射层保持纯函数（`shortcuts.ts`）：`resolveMarkdownShortcut(event, bindings)`，
第一行仍是 IME guard，未命中的组合一律返回 `null`，不 `preventDefault`。

默认值（与 R1 相同）：

```
bold Ctrl+B    italic Ctrl+I    link Ctrl+K
heading1..6 Ctrl+1..6
ul Ctrl+Shift+1    ol Ctrl+Shift+2
inlineCode Ctrl+Shift+Q    codeBlock Ctrl+Shift+W
blockMath Ctrl+Shift+A     inlineMath Ctrl+Shift+S
table Ctrl+Shift+B
```

（M1.1 首次实现时为 `ol/ul = Ctrl+Shift+7/8`、`inlineCode/codeBlock = Ctrl+Shift+V/C`、
`inlineMath = Ctrl+Shift+X`、`blockMath = Ctrl+Shift+M`，最终调整见 §13.10。）

#### 12.2.2 Settings UI（`src/features/settings/MarkdownShortcutsSection.tsx`）

位置：Settings 面板，紧跟"显示/隐藏窗口快捷键"之后。

- 点击某项的组合键按钮 → 进入录制（capture 阶段拦截 `keydown`，`stopPropagation` 阻止编辑器快捷键同时触发）。
- 只按修饰键继续等待；`Esc` 取消；合法组合立即写回 config。
- 冲突时显示"与「XX」冲突"，**不写入**，继续等待下一次按键（不静默覆盖）。
- 保留组合（`Ctrl+Z/Y/S/A/C/V/X`）直接拒绝并提示。
- 每一项右侧 `↺` 单项恢复默认（若默认键已被别人占用则提示冲突），标题右侧"全部恢复默认"写回 `{}`。

#### 12.2.3 持久化：为什么必须动一行 Rust

**审计结论**：`config.json` 由 Rust 的 `AppConfig` 严格反序列化（`services/notes.rs:24`，
`#[serde(rename_all = "camelCase")]`，逐字段），保存时整个结构体重新序列化写盘；
`load_config` 每次启动还会 `write_json_atomic` 重写一次（`notes.rs:721`）。
因此**前端单方面多加的字段一定会在下一次保存/启动时被丢弃**，
"重启后配置保留"不可能通过只改 TS 实现。

现有 Settings 架构就是 `SettingsPanel → saveConfig() → config.json → config-changed 广播`。
要走这条链路，就必须让 Rust 认识这个字段。所以新增了 R2 中唯一一处 Rust 改动：

```rust
// services/notes.rs, AppConfig 内
#[serde(default)]
pub markdown_shortcuts: BTreeMap<String, String>,
```

- `#[serde(default)]`：旧 config.json 没有该字段也能正常加载，读出来是空 map → 前端回落默认。
- 只动**配置模型**：不碰 `notes/` 目录、`metadata.json`、UUID、文件名、autosave、导入导出路径。
- 连带补了 5 处 `AppConfig` 字面量（`default_config` + 4 处测试构造），全部是 `Default::default()`。
- `cargo check` PASS。

**为什么不用 localStorage**：那是第二个存储系统（违反 R2-B.7），而且 MainWindow 与 NotePad
分别读写会各自漂移；`config.json` 才是唯一真相源。

#### 12.2.4 生效链路

```
SettingsPanel ─ onChange ─▶ MainWindow.handleSettingsChange
                              ├─ emit("config-changed", config)
                              │     └─▶ useMarkdownShortcutBindings
                              │           ├─ MainWindow  → useMarkdownShortcuts
                              │           └─ NotePad     → useMarkdownShortcuts
                              └─ saveConfig(config)（300ms 防抖）─▶ config.json（Rust 持久化）

窗口启动：getConfig() → config.markdownShortcuts → resolveMarkdownShortcutBindings()
```

两个窗口各自持有一份 hook，但来源是同一份 config 与同一个广播事件，所以改完立刻同时生效，
不需要额外的窗口间通道，也没有 Rust global shortcut。

#### 12.2.5 允许绑定的范围

| 规则                       | 说明                                              |
| -------------------------- | ------------------------------------------------- |
| 必须含 `Ctrl` 或 `Command` | 否则会和正常输入冲突                              |
| 只接受单字符键             | Tab / Escape / 方向键 / F1 等基础编辑键一律不接管 |
| 保留 `z y a c v x s`       | 撤销、重做、全选、剪贴、粘贴、剪切、保存          |
| 不允许重复                 | 冲突时阻止保存并提示占用者                        |

### 12.3 验证矩阵（R2）

| 验证项                                     | 方式                                                                      | 结果                       |
| ------------------------------------------ | ------------------------------------------------------------------------- | -------------------------- |
| Ctrl+Z 一次撤销                            | `execCommand` 调用次数 = 1，参数是最小 replacement                        | PASS（结构断言）           |
| undo 不留下全文全选                        | 断言调用时选区是 `[4, 9)` 而非 `[0, len]`                                 | PASS                       |
| 全选场景的兜底                             | `createUndoSelectionGuard` 4 个用例（undo/redo/部分选区/非 history 事件） | PASS                       |
| Ctrl+Y / Redo                              | redo 不接管，兜底同样覆盖 `historyRedo`                                   | PASS（未改动 native redo） |
| Bold / Italic / Link / H1-H6 / List 的区间 | `commands.test.ts` 最小编辑区间组                                         | PASS                       |
| Toolbar 无回归                             | heading 循环、hr、quote、code 等旧断言全部保留                            | PASS                       |
| 自定义 Bold 后旧键失效                     | `shortcuts.test.ts` + `useMarkdownShortcuts.test.ts` 双层                 | PASS                       |
| MainWindow / NotePad 同时生效              | 同一 hook + 同一 config 源；派发路径有测试，窗口间同步靠 `config-changed` | 逻辑 PASS / 需人工确认     |
| duplicate conflict                         | `findShortcutConflict` + `resolve` 去重用例                               | PASS（UI 拦截需人工确认）  |
| Reset / Reset All                          | `resolveMarkdownShortcutBindings({})` 回落默认 + UI 写回                  | 逻辑 PASS / 需人工确认     |
| 重启后保留                                 | 字段落 `config.json`（`#[serde(default)]`），需重建 Rust 二进制后实测     | 需人工确认                 |
| IME                                        | `isComposing` / `keyCode 229` 仍返回 null                                 | PASS                       |
| Toolbar 与快捷键共用 command               | 两者都调 `applyMarkdownCommand`                                           | PASS                       |

### 12.4 测试与构建

```
vitest:  28 文件 / 200 用例 全部通过
其中 M1 相关：commands 31、shortcutBindings 23、shortcuts 23、useMarkdownShortcuts 13 = 90
（R1 为 50 → R2 净增 40）
```

| 命令                                            | 结果                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------- |
| `npx tsc --noEmit`                              | PASS                                                                      |
| `npx oxlint src/features src/components`        | PASS（0 warnings / 0 errors，76 文件）                                    |
| `npx oxfmt --check src/features src/components` | PASS                                                                      |
| `npx vite build --outDir <临时目录>`            | PASS（989ms，`index-*.js` 232.62 kB）                                     |
| `cargo check`（src-tauri）                      | PASS（17m02s，首次编译依赖树）                                            |
| `npm run build`（原地写 `dist/`）               | **仍被沙箱拦截**（vite 清空 `dist/assets`），改用临时 outDir 跑同一份产物 |

`vite.config.ts`、`package.json`、`index.html` 与 Tauri 配置均未改动，前端产物与源码一一对应。

### 12.5 已知限制

1. **必须重建 Rust 二进制**：前端产物变了、`config.json` 多了字段，旧 exe 不认识该字段会把它丢掉。
   本阶段只做到 `cargo check` PASS；`tauri build` 与真机重启验证留给人工闭环。
2. 设置面板的**录制交互**（点击后捕获、Esc 取消、冲突提示、单项/全部重置）没有 DOM 测试：
   仓库未安装 jsdom / testing-library。逻辑层（解析、校验、冲突、回落）全部有测试覆盖。
3. 快捷键必须含 `Ctrl`/`Command`；不支持纯 `Alt` 组合（与 Windows 的 AltGr / 菜单键冲突）。
4. 手改 `config.json` 造成重复绑定时，后出现的那一项回落默认值，不会静默变成同一个组合。
5. 多行选区执行 `Ctrl+1~6` 仍只作用于起始行（同 R1 §9）。
6. `Ctrl++` 这类以 `+` 为按键的绑定可解析，但显示为 `Ctrl + +`，属可接受的显示瑕疵。
7. 兜底 guard 只在"整篇全选"时介入；正常 undo 不会被动过选区。

### 12.6 人工验收清单（R2）

1. 改完 Bold 快捷键（例如 `Ctrl+Shift+B`）后：新键生效、`Ctrl+B` 不再加粗。
2. 同时在 MainWindow 与 NotePad 里验证同一组快捷键（两边都要重启后仍然一致）。
3. 录制时按下已被占用的组合 → 出现冲突提示且原绑定不变。
4. 单项 `↺` 与"全部恢复默认"后，键位回到默认；重启应用后仍为默认。
5. 选中一段文字 `Ctrl+B` → `Ctrl+Z`：内容恢复、**没有任何全文全选**；`Ctrl+Y` 重做正常。
6. 全选全文 `Ctrl+B` → `Ctrl+Z`：同样不应停在全文全选。
7. 中文输入法候选框展开时按 `Ctrl+B`：不产生 `**`。
8. Toolbar 各按钮行为与 R1 一致。

### 12.7 结论

R2-A 在不引入 JS undo history 的前提下消除了全选副作用；
R2-B 把映射表改为配置驱动并接进既有 Settings 架构，MainWindow 与 NotePad 共用同一份绑定。

未完成但已明确归属人工闭环的三项：`tauri build` 后的重启持久化、双窗口实机验证、录制器 UI 交互。
这三项在收口时**未被单独复述**，因此不记为独立 PASS，状态见 §14.2。

**M1 R2: CLOSURE PASS**

---

## 13. M1.1：扩展 Markdown 快捷键

> 范围：在既有 command 层与配置驱动绑定层上新增 5 个 action。
> 不进 M2 Storage、不改 Rust、不重构、未 commit。

### 13.1 结论

5 个新 action 全部走**同一个** `applyMarkdownCommand()`，没有第二套字符串拼接；
绑定表新增 5 个 id，自动出现在 Settings → Markdown Shortcuts，
MainWindow 与 NotePad 因为都经 `useMarkdownShortcutBindings()` 取表（`MainWindow.tsx:1428`、
`NotePad.tsx:442`）而自动同时生效 —— 新增 action 时这两个组件无需改动
（最终收口时各删掉一行 `translate: t`，原因见 13.11）。

### 13.2 `Ctrl+Shift+Z` 让给原生 Redo

最终默认表（13.6）完全采用指定组合，其中不含 `Ctrl+Shift+Z`。这条证据仍值得保留：
它既解释了为什么该组合不进默认表，也说明了用户手动绑上去之后会发生什么。

| 证据                   | 内容                                                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Chromium/WebView2 行为 | Windows 下可编辑区域内 `Ctrl+Shift+Z` 是**原生重做**（`Ctrl+Y` 之外的第二个绑定）                                       |
| Floral 自身文案        | 重做按钮 tooltip 写死"重做（Ctrl+Y）"（`MainWindow.tsx:2611`），说明上游只承诺 `Ctrl+Y`                                 |
| Floral 菜单            | 全仓库无任何 accelerator，Windows 侧 `MenuItem::with_id(..., None::<&str>)` 最后一个参数全是 `None`（`desktop.rs:735`） |
| `preventDefault` 后果  | 我们的 handler 一旦命中就 `preventDefault()`，会**吞掉**原生 redo —— 用户按 `Ctrl+Shift+Z` 得到的是插入公式，不是重做   |

因此：

- `Ctrl+Shift+Z` **不是默认值**，但**仍可手动绑定**（见 13.4）。用户绑上去等于自愿放弃这一条 redo，
  `Ctrl+Y` 与 Toolbar 重做按钮始终不受影响。
- `Ctrl+Shift+A / S / Q / W / B` 在可编辑区域没有浏览器默认行为，不会与 Undo/Redo 竞争：
  Chromium 的"另存为"是 `Ctrl+S`、剪贴板是 `Ctrl+C/V/X`，加上 Shift 都是另一个组合。
  `Ctrl+Shift+A` / `Ctrl+Shift+W` 在 Chrome 浏览器里分别对应"标签页搜索"和"关闭窗口"，
  但那是**浏览器 UI 层**功能，WebView2 没有标签栏，Tauri 宿主也不注册这两个 accelerator；
  这一点仍列入 13.9 的人工抽检，因为 WebView2 的 browser accelerator 集合取决于运行时版本。

### 13.3 修改文件

| 文件                                                                                                   | 变化                                                                                                                    |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `src/features/markdown/commands.ts`                                                                    | 68 行变更：`MarkdownAction` 增 `inlineCode` / `codeBlock` / `table`；新增 `blockPadding()`；改写 `blockMath` 的换行策略 |
| `src/features/markdown/shortcutBindings.ts`                                                            | 42 行变更：5 个新 id + 默认键；`isReservedMarkdownBinding` 放宽 Shift/Alt 变体；`commandForShortcutId` 补分支           |
| `src/features/settings/MarkdownShortcutsSection.tsx`                                                   | 10 行变更：5 个标签键与回退文案（`satisfies Record<MarkdownShortcutId, string>` 逼着补齐）                              |
| `src/locales/{zh-CN,en-US,zh-HK}/translation.json`                                                     | 各 +5 行：`settings.markdownShortcuts.action.*`                                                                         |
| `commands.test.ts` / `shortcutBindings.test.ts` / `shortcuts.test.ts` / `useMarkdownShortcuts.test.ts` | 共 +378 行：语义、最小区间、默认映射、冲突、IME、handler 全链路                                                         |
| `MarkdownPreview.test.tsx`                                                                             | +37 行：用 command 的真实输出喂渲染器，断言表格与 KaTeX                                                                 |

`shortcuts.ts`、`useMarkdownShortcuts.ts`、`MainWindow.tsx`、`NotePad.tsx`、`useMarkdownShortcutBindings.ts`
**未改动** —— 映射层本来就是遍历 `MARKDOWN_SHORTCUT_IDS`，加 id 即生效。

### 13.4 保留键修正

原判定是"只要 base key 在 `z/y/a/c/v/x/s` 里就拒绝"，于是 `Ctrl+Shift+V` 会被误拒。
现在只在**没有 Shift、没有 Alt** 时才算基础组合（`shortcutBindings.ts:173`）：

```ts
if (!parsed.ctrl && !parsed.meta) return true; // 必须带主修饰键
if (parsed.shift || parsed.alt) return false; // 带 Shift/Alt 就是另一个组合
return RESERVED_SHORTCUT_KEYS.includes(parsed.key);
```

于是 `Ctrl+Z / Y / A / C / V / X / S` 依然拒绝，
而 `Ctrl+Shift+A / S / Q / W / B / Z`、`Ctrl+Alt+V` 全部放行 ——
默认表里的 `Ctrl+Shift+A`（块级公式）与 `Ctrl+Shift+S`（行内公式）正依赖这条规则。

同步更新的两处旧断言（它们写死了"`Ctrl+Shift+B` 无冲突"，而该键现在是表格的默认值）：
`findShortcutConflict` 用例改为断言返回 `"table"`；`resolveMarkdownShortcutBindings` 的
"valid overrides" 用例改用 `Ctrl+Alt+B`。

### 13.5 Command 语义

统一原则：**有选区 → 包裹已有内容；无选区 → 只插入最小合法 Markdown 结构，不生成任何示例文本**，
光标直接落在可输入位置。Toolbar 与快捷键调用同一个 command，因此两者行为完全一致。

| Command                | 有选区               | 无选区                               | 执行后 caret / selection            |
| ---------------------- | -------------------- | ------------------------------------ | ----------------------------------- |
| Bold                   | `**hello**`          | `****`                               | 选中原文 / caret 落在两对 `*` 之间  |
| Italic                 | `*hi*`               | `**`                                 | 同上                                |
| Link                   | `[hi](url)`          | `[]()`                               | 选中 `url` / caret 落在 `[]` 内     |
| Inline Code            | `` `hello` ``        | &#96;&#96;（两个反引号）             | 选中原文 / caret 落在反引号之间     |
| Inline Math            | `$E=mc^2$`           | `$$`                                 | 选中公式 / caret 落在两个 `$` 之间  |
| Code Block             | ` ```\nhello\n``` `  | ` ```\n\n``` `                       | 选中代码正文 / caret 落在空行行首   |
| Block Math             | `$$\nE=mc^2\n$$`     | `$$\n\n$$`                           | 选中公式 / caret 落在空行行首       |
| Table                  | 不区分（空 2×2 GFM） | `\|  \|  \|` + 分隔行 + `\|  \|  \|` | caret 落在第一个表头单元格          |
| Heading（Toolbar `H`） | `## 选区文本`        | `## `                                | caret 落在记号之后                  |
| H1–H6（`setHeading`）  | 只改行首记号         | 插入 `# ` … `###### `                | caret 跟随记号平移                  |
| UL / OL                | 逐行加 `- ` / `n. `  | `- ` / `1. `                         | 选中生成的列表 / caret 落在记号之后 |
| Quote                  | 逐行加 `> `          | `> `                                 | 同上                                |
| Code（Toolbar 自适应） | 单行→行内，跨行→围栏 | &#96;&#96;                           | 同上                                |
| HR                     | —                    | `---`                                | caret 落在 `---` 之后               |

补充说明：

- **块级语法的换行**由 `blockPadding()`（`commands.ts`）处理：只有当 `$$` / ` ``` ` / 表格
  会被"粘"在上一行或下一行正文上时才补一个换行。整行选中时结果就是 `$$\nE=mc^2\n$$`，
  不会有前后多余空行。
- 空块不会让预览报错：`MarkdownPreview` 对 `$$\n\n$$` 与 ` ```\n\n``` ` 都有自动化用例
  （见 13.7），空表格也能渲染成带 2 个 `<th>` 的真表格 —— 这是"插入即看到结构"的前提。
- `inlineCode` / `codeBlock` 与 Toolbar 既有的 `code` action 并存：`code` 仍按"单行→行内、
  跨行→围栏"自适应；`inlineCode` / `codeBlock` 语义固定，供快捷键使用。
- 移除示例文本后，`main.formatSample.*` 这 7 个 locale 键已无引用。本次**保留**它们
  （删除属于独立清理，不影响行为），后续里程碑可一并移除。

### 13.6 默认键

| Action      | 默认键              | 备注                                                  |
| ----------- | ------------------- | ----------------------------------------------------- |
| 无序列表    | `Ctrl+Shift+1`      | 数字键走 `event.code`，Shift 后 `key` 变 `!` 也能命中 |
| 有序列表    | `Ctrl+Shift+2`      | 同上                                                  |
| 行内代码    | `Ctrl+Shift+Q`      |                                                       |
| 代码块      | `Ctrl+Shift+W`      |                                                       |
| 块级公式    | `Ctrl+Shift+A`      | 不用 `Ctrl+Shift+Z`，理由见 13.2                      |
| 行内公式    | `Ctrl+Shift+S`      | 与 `Ctrl+S`（保存）是两个组合，保留键判定已区分       |
| 表格        | `Ctrl+Shift+B`      |                                                       |
| 粗体 / 斜体 | `Ctrl+B` / `Ctrl+I` | R1 既有，未改                                         |
| 链接        | `Ctrl+K`            | R1 既有，未改                                         |
| H1–H6       | `Ctrl+1`–`Ctrl+6`   | exact heading，同级再按为 no-op                       |

全部可改、有冲突检测、支持单项 `↺` 与"全部恢复默认"（复用 R2 的同一套 UI 与逻辑，无新增分支）。
Settings 面板的显示顺序由 `MARKDOWN_SHORTCUT_IDS`（`shortcutBindings.ts:32`）决定，
已调整为与上表一致（无序列表在有序列表之前）；显示文案由 `formatMarkdownBinding()` 从当前绑定
实时生成，没有任何硬编码键名。

### 13.7 测试与构建结果

| 项目                             | 结果                                                               |
| -------------------------------- | ------------------------------------------------------------------ |
| `npx tsc --noEmit`               | PASS                                                               |
| `npx vitest run`                 | **28 文件 / 263 用例全过**（R2 为 200，M1.1 首轮 241，收口后 263） |
| ├ `commands.test.ts`             | 66（含"任何 command 都不残留 CJK 占位符"的参数化用例）             |
| ├ `shortcutBindings.test.ts`     | 36（默认值、Settings 显示、唯一性、保留键放宽、扩展冲突）          |
| ├ `shortcuts.test.ts`            | 29（7 个默认映射、旧键失效、Ctrl+Shift+Z 留空、重绑定释放旧键）    |
| ├ `useMarkdownShortcuts.test.ts` | 16（新命令全链路、手动绑 Ctrl+Shift+Z、IME）                       |
| └ `MarkdownPreview.test.tsx`     | 8（直接用 command 产物喂渲染器：空表格、空围栏、空公式块）         |
| `npx oxlint src`                 | 87 文件 0 warning / 0 error                                        |
| `npx oxfmt --check`              | clean                                                              |
| `npx vite build`                 | PASS（955ms，`index-*.js` 234 kB、`MarkdownPreview-*.js` 331 kB）  |

`npm run build` 原地构建仍会清空 `dist/assets`（沙箱批量删除确认），沿用 R2 的做法构建到临时 outDir，
产物同源；仓库 `dist/` 未被动过。

覆盖到的验证项：inline math 有/无选区、block math 有/无选区（含行中光标、段落之间）、
inline code 有/无选区（含跨行仍保持行内）、code block 有/无选区、空表格插入与首个单元格 caret、
所有 command 无选区时不产出任何文字（含 CJK 占位符检查）、每项的最小编辑区间、
`applyMarkdownCommand` 单次 `insertText`、默认映射、自定义绑定、
重复冲突、Reset / Reset All（逻辑层与 R2 同一实现）、双窗口共用同一绑定源、IME、locale 键齐平。

### 13.8 已知限制

1. **`Ctrl+Shift+Z` 的取舍是产品决定**：不进默认表（块级公式用 `Ctrl+Shift+A`），但允许用户绑；
   一旦绑定，该组合下不再触发原生 redo（`Ctrl+Y` 与 Toolbar 重做按钮不受影响）。
2. 表格插入不接受选区内容做转换（第一版明确不做），选区会被替换掉。
3. 行内公式不处理跨行选区：`$a\nb$` 在 CommonMark 行内语义下不会渲染成公式，
   要写多行公式请用块级。
4. `codeBlock` / `blockMath` 无选区时插入的空块在预览里没有可见内容（只有标记本身），
   这是"用户还没输入"的中间状态，不是渲染缺陷；`codeBlock` 也没有语言标记选择器（第一版不做）。
5. 空表格的表头单元格不含任何文字，列名需要用户自己输入；第一版不做 Table Editor。
6. `Ctrl+Shift+1 / 2` 依赖 `event.code`（`Digit1` / `Digit2`）。当前 WebView2 完整上报 `code`；
   若某个极端环境不报 `code`，会退化为 `event.key`，而 Shift+1 的 `key` 是 `!`，该组合将不命中。
   `Ctrl+Shift+Q/W/A/S/B` 不依赖这一点（字母键无论如何都能从 `key` 还原）。
7. `main.formatSample.*`（7 个键 × 3 语言）已无引用，本次保留未删，避免扩大改动面。

### 13.9 人工验收清单（M1.1）

1. 选中 `E=mc^2` 按 `Ctrl+Shift+S` → 预览出现行内公式；再按 `Ctrl+Z` 一次回到原文，无全文全选。
2. 整行选中 `E=mc^2` 按 `Ctrl+Shift+A` → 得到 `$$\nE=mc^2\n$$`，预览为居中公式块。
3. 无选区按 `Ctrl+Shift+A` → 得到空块 `$$\n\n$$`，光标在中间那行，直接输入公式即可。
4. 选中 `hello` 按 `Ctrl+Shift+Q` → `` `hello` ``；按 `Ctrl+Shift+W` → 围栏代码块。
5. 无选区按 `Ctrl+Shift+B` → 插入空 2×2 表格，光标在第一个表头单元格内，预览已是真表格。
6. 任意行按 `Ctrl+Shift+1` → 无序列表；`Ctrl+Shift+2` → 有序列表。
   6b. **无选区**按 `Ctrl+B` → `****` 且光标在两对星号中间，直接打字即为粗体；
   `Ctrl+I` → `**`；`Ctrl+Shift+Q` → 一对反引号；`Ctrl+Shift+S` → `$$`；`Ctrl+K` → `[]()`。
7. 设置面板出现 7 行新增项，可录制、可单项恢复、可全部恢复；改完两窗口同时生效。
8. 按 `Ctrl+Shift+Z` 应仍是**重做**（未被默认占用）；`Ctrl+Y` 重做正常。
9. 按 `Ctrl+Shift+A` / `Ctrl+Shift+S` 不应触发浏览器级动作（标签页搜索 / 另存为）。
10. 中文输入法候选框展开时按任一新增组合 → 不插入任何标记。

### 13.10 默认键最终调整

按最终确认的表替换了 7 个默认组合。**只动默认值与测试，command 层、绑定模型、hook、
两个窗口组件、Rust 侧全部零改动**：

| 文件                           | 变化                                                                        |
| ------------------------------ | --------------------------------------------------------------------------- |
| `shortcutBindings.ts`          | 默认表 7 项；`MARKDOWN_SHORTCUT_IDS` 中 `ul` 提到 `ol` 前（对齐展示顺序）   |
| `shortcutBindings.test.ts`     | 默认值断言、Settings 显示断言、冲突断言改为新键；Digit1 捕获用例            |
| `shortcuts.test.ts`            | 默认映射改用新键；新增「旧键 `Ctrl+Shift+7/8` 已失效」；重绑定用例改 Digit1 |
| `useMarkdownShortcuts.test.ts` | 全链路用例的内联代码按键由 `Ctrl+Shift+V` 改为 `Ctrl+Shift+Q`               |
| `M1_Markdown_Shortcuts.md`     | 本节与 13.2 / 13.4 / 13.6 / 13.7 / 13.8 / 13.9                              |

兼容性说明：`config.json` 的 `markdownShortcuts` 只在用户**主动改绑**时写入对应项，
默认值从不落盘。所以没改过快捷键的用户升级后直接得到新默认；
改过某项的用户保留自己的选择（`resolveMarkdownShortcutBindings` 以覆盖优先），
这正是 R2 设计的预期行为。

验证：`tsc` PASS、`vitest` **28 文件 / 243 用例全过**、`oxlint` 0/0、`oxfmt --check` clean、
`vite build` 到临时目录 PASS（1.17s）。未执行 Git commit。

### 13.11 无选区行为收口：不再生成任何示例文本

旧行为会在无选区时插入「粗体文本」「列表项」「链接文本」「代码」「标题」以及
`Header 1 / Cell 1` 这类占位内容。问题在于它们**是真实写入正文的字符**：
用户想写 `**foo**` 得先把「粗体文本」删掉，想填表格得逐个删掉 Header/Cell。

现在统一为：**只插入最小合法 Markdown 结构，光标落在可输入位置**。

| Command                | 旧（无选区）                                           | 新（无选区）                          |
| ---------------------- | ------------------------------------------------------ | ------------------------------------- |
| Bold                   | `**粗体文本**`（选中文本）                             | `****`，caret 在中间                  |
| Italic                 | `*斜体文本*`                                           | `**`，caret 在中间                    |
| Link                   | `[链接文本](url)`（选中 url）                          | `[]()`，caret 在 `[]` 内              |
| Inline Code            | `` `代码` ``                                           | &#96;&#96;，caret 在中间              |
| Inline Math            | `$E=mc^2$`（选中公式）                                 | `$$`，caret 在中间                    |
| Code Block             | 已是空块（不变）                                       | ` ```\n\n``` `                        |
| Block Math             | `$$\nx^2+y^2=r^2\n$$`                                  | `$$\n\n$$`                            |
| Table                  | `Header 1 / Header 2 / Cell …`                         | `\|  \|  \|` + 分隔行 + `\|  \|  \|`  |
| Heading（Toolbar `H`） | `## 标题`（选中"标题"）                                | `## `                                 |
| UL / OL / Quote / Code | `- 列表项` / `1. 列表项` / `> 引用文本` / `` `代码` `` | 只有 `- ` / `1. ` / `> ` / &#96;&#96; |

#### 13.11.1 Toolbar 与快捷键的一致性

Toolbar 的 10 个按钮与快捷键**本来就调用同一个** `applyMarkdownCommand()`
（`MainWindow.tsx` 的 `toolbarButtons.map`），所以上表对两者同时生效，
不存在"快捷键是新行为、Toolbar 还是旧行为"的分叉。`hr` 没有示例文本，未受影响。

#### 13.11.2 顺带移除的 `translate` 参数

`computeMarkdownEdit()` / `applyMarkdownCommand()` / `useMarkdownShortcuts()`
原有一个 `translate: TFunction` 参数，唯一用途就是取那几句示例文本。
示例文本移除后它变成纯死参数，而 `tsconfig` 开着 `noUnusedParameters`，
留着会直接编译失败。因此一并删除，调用点同步更新：

- `src/features/markdown/commands.ts`：两个函数的签名
- `src/features/markdown/useMarkdownShortcuts.ts`：`MarkdownShortcutDependencies` 与
  `UseMarkdownShortcutsOptions` 去掉 `translate`，`dependenciesRef` 同步收窄
- `src/components/MainWindow.tsx`：Toolbar 调用与 hook 选项各去掉一个实参
- `src/components/NotePad.tsx`：hook 选项去掉一个实参

这是**删除失效参数**，不是新建抽象；`t` 在两个组件里仍有其它用途，未受影响。

#### 13.11.3 验证

| 项目                | 结果                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `tsc --noEmit`      | PASS（`noUnusedParameters` 全绿）                                                          |
| `vitest`            | **28 文件 / 263 用例全过**（+20：command 无选区语义重写、空表格/空块渲染、CJK 占位符检查） |
| 空表格渲染          | `\|  \|  \|` + `\| --- \| --- \|` 被 remark-gfm 识别为真表格，产出 2 个 `<th>`             |
| 空围栏 / 空公式块   | 均能渲染且不抛错（`<pre>` / 可选中容器）                                                   |
| `oxlint src`        | 87 文件 0/0                                                                                |
| `oxfmt --check src` | clean                                                                                      |
| `vite build`        | PASS（955ms）                                                                              |

新增的关键用例：

- `no command invents sample content`：对 13 个 command 逐一断言无选区产物**不含任何中日韩字符**，
  这条会在未来有人重新加回占位文本时立刻失败。
- `the table carries no sample cells at all`：断言不含 `Header` / `Cell`。
- `the caret lands inside the first header cell`：断言 caret 位置使前缀恰为 `| `。
- 渲染层三条：空表格 2 个 `<th>`、空围栏 `<pre>`、空公式块不崩。

**M1.1: CLOSURE PASS**

---

## 14. Final Closure（M1 / M1.1 合并收口）

### 14.1 收口前置检查

| 检查项                                   | 结果                                                           |
| ---------------------------------------- | -------------------------------------------------------------- |
| `src/features/livePreview/`              | 不存在（已整体回退）                                           |
| 源码中 `livePreview` / `CodeMirror` 引用 | 0 处（`grep -rln` 为空）                                       |
| `package.json` / `package-lock.json`     | 无 `@codemirror/*`、无 `@lezer/*`，两者相对 HEAD 均无差异      |
| `ViewMode`                               | `"edit" \| "split" \| "preview"`，无 `"live"`                  |
| 顶部模式组                               | `编辑 \| 分栏 \| 预览`                                         |
| 构建产物入库                             | 无：`dist/`、`src-tauri/target/`、`node_modules/` 均未 tracked |

### 14.2 人工验收（已完成）

用户在应用中实际使用后确认通过，明确覆盖以下四项：

| 验收项                                                     | 结果 |
| ---------------------------------------------------------- | ---- |
| 13 个 command 的快捷键触发                                 | PASS |
| 无选区时只产出最小 Markdown 结构，不生成任何示例文本       | PASS |
| Undo / Redo 后选区不再出现整篇全选                         | PASS |
| Settings → Markdown Shortcuts 自定义绑定（含冲突与 Reset） | PASS |

以下三项在 §12.6 / §13.9 清单中曾列为待闭环，收口时**未被单独复述**，
故不记为独立 PASS，留作后续实机关注点（代码路径与已验收项相同，无额外分支）：

- `tauri build` 产物重启后绑定持久化；
- MainWindow / NotePad 双窗口同时打开时各自生效；
- 中文 IME 组合期按快捷键被抑制（`isComposing` / `keyCode === 229` 守卫，已有单测）。

### 14.3 最终增量验证

| 项目            | 结果                      |
| --------------- | ------------------------- |
| `tsc --noEmit`  | PASS                      |
| `vitest`        | 28 文件 / 263 用例全过    |
| `oxlint src`    | 87 文件 0 warning 0 error |
| `oxfmt --check` | clean                     |
| `vite build`    | PASS                      |

### 14.4 提交

`feat(editor): complete markdown editing shortcuts`

本次提交范围：Markdown command 层、快捷键映射与自定义绑定、Settings 录制 UI、
三语言文案、撤销选区修复、本报告。
**不含** Live Preview 任何代码与依赖，不含构建产物。

`LIVE_PREVIEW_M0.md` 作为 `PROTOTYPE VALIDATED / DEFERRED` 技术记录保留在
工作区（untracked），不属于本次提交。

### 14.5 最终状态

`M1/M1.1 CLOSURE: PASS`
