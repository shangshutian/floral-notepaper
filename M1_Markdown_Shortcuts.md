# M1 Markdown Shortcuts

> 阶段范围：仅 Markdown 编辑快捷键。
> 不涉及 M2 Storage、不修改 notes 存储、不动 updater、未做无关重构、未执行 Git commit。
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
最终结论见 §12.7。

**M1 R2: READY FOR MANUAL CLOSURE**

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
Toolbar 按钮 (MainWindow.tsx:2781)
        │
        └──────────────┐
                       ▼
            applyMarkdownCommand(textarea, command, t, setContent, markDirty)
                       ▲
        ┌──────────────┘
document keydown (useMarkdownShortcuts.ts:88)
        │  resolveMarkdownShortcut(event)  → MarkdownCommand | null   (shortcuts.ts:42)
        ▼
computeMarkdownEdit(value, start, end, command, translate)           (commands.ts:57)
        ▼
{ result, cursorStart, cursorEnd } | null（null = no-op）
        ▼
setSelectionRange(0, len) → execCommand("insertText", false, result)  (commands.ts:274)
```

三层职责与文件一一对应：

- `commands.ts`：`MarkdownAction`（无参数 command，也就是 Toolbar 的 10 个按钮）+ `SetHeadingCommand`（`{ type: "setHeading", level }`）。`computeMarkdownEdit()` 是纯函数（无 DOM），`applyMarkdownCommand()` 只负责落盘式应用。返回 `false` 表示 no-op，此时 DOM、`setContent`、`markDirty` 都不会被触碰。
- `shortcuts.ts`：只有映射，不读 textarea、不调 `preventDefault`，可直接用普通对象测试。
- `useMarkdownShortcuts.ts`：`createMarkdownShortcutHandler()` 与 React 解耦（可测），`useMarkdownShortcuts()` 只做一次 `document.addEventListener("keydown")`，用 ref 持有最新回调，避免每次输入重绑。

Toolbar 的 `heading` 循环行为逐字保留（`commands.ts:127-154`），新增的 `setHeading` 是独立分支（`commands.ts:79-99`），两者互不影响。

## 4. Shortcut mapping

> R2 起这张表只是**默认值**，实际生效的绑定来自 Settings（§12.2）。
> 下表的按键仍可通过设置面板改写，`Ctrl+Z/Y/S/A/C/V/X` 属保留组合，不允许绑定。

| 按键                | Command                         | 说明                                                                   |
| ------------------- | ------------------------------- | ---------------------------------------------------------------------- |
| `Ctrl+B`            | `bold`                          | 有选区包裹选区；无选区插入本地化示例文本                               |
| `Ctrl+I`            | `italic`                        | 同上                                                                   |
| `Ctrl+K`            | `link`                          | `[文本](url)`，生成后**选中 `url` 占位符**，直接输入/粘贴即可替换      |
| `Ctrl+1` … `Ctrl+6` | `{ type: "setHeading", level }` | 精确设置，已是同级则 **no-op**                                         |
| `Ctrl+Shift+7`      | `ol`                            | 数字键优先用 `event.code === "Digit7"` 判定，避免布局相关 `key`（`&`） |
| `Ctrl+Shift+8`      | `ul`                            | 同上（`Digit8` / `*`）                                                 |

其余一律返回 `null`，不 `preventDefault`：
`Ctrl+Z / Ctrl+Y / Ctrl+S / Ctrl+A / Ctrl+C / Ctrl+V / Ctrl+X / Tab / Escape / 裸字母 / AltGr(Alt+…)`。

附加兼容：

- `Cmd`（`metaKey`）等价于 `Ctrl`，沿用仓库既有 `ctrlKey || metaKey` 约定（`MainWindow.tsx` 的 Ctrl+S 同款）。
- 非拉丁键盘布局下 `event.key` 不是 `b` 时，回退按物理键 `event.code === "KeyB"` 命中。
- 小键盘 `Numpad3` 与主键盘 `Digit3` 等价（`Ctrl+3`）。
- 标题键位只在**无 Shift** 时生效，`Ctrl+Shift+1`（`!`）不会被误判。

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
6. 未纳入本阶段的 Typora 组合：`Ctrl+Shift+B`（引用）、`Ctrl+Shift+\``（行内代码）、`Ctrl+Shift+K`（删除线）。
7. 若输入法在 composition **之外**注册并吞掉 `Ctrl+B` 这类组合（少见），应用仍会接管；IME 保护只覆盖组合态。
8. 未安装 jsdom / testing-library，因此"真实 DOM 回放 Ctrl+Z"与"真实 IME 组合"没有自动化用例，靠结构断言 + 人工验收。

## 10. 人工验收清单（建议在应用中确认一次）

1. MainWindow：选中文本 `Ctrl+B` → 加粗；`Ctrl+Z` 一次撤销回原状（不是退两次，也不是整篇回滚）。
2. MainWindow：光标在 `## 标题` 行按 `Ctrl+2` → 无变化（no-op）；按 `Ctrl+4` → 变成 `#### 标题`；Toolbar `H` 仍是循环升级。
3. MainWindow：`Ctrl+Shift+8` 多行选区 → 每行加 `- `。
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

绑定 = 一个可序列化字符串（`Ctrl+B` / `Ctrl+Shift+7`），同时用于持久化、显示与匹配。

| 能力          | 函数                                                | 规则                                                                                                                      |
| ------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 解析 / 归一化 | `parseMarkdownBinding` / `normalizeMarkdownBinding` | 修饰键大小写不敏感；字母统一大写；`Ctrl/Control`、`Meta/Command/Cmd` 同义                                                 |
| 显示          | `formatMarkdownBinding`                             | `Ctrl + Shift + 7`                                                                                                        |
| 捕获          | `bindingFromShortcutEvent`                          | 字母/数字走 `event.code`（布局无关），符号走 `event.key`；返回 ok / modifierOnly / needsModifier / reserved / unsupported |
| 冲突          | `findShortcutConflict`                              | 同一条绑定被两个 action 占用                                                                                              |
| 合并          | `resolveMarkdownShortcutBindings`                   | 默认表 + 合法覆盖；非法/保留/重复的覆盖回落默认，永远输出一套可用且无冲突的绑定                                           |

映射层保持纯函数（`shortcuts.ts`）：`resolveMarkdownShortcut(event, bindings)`，
第一行仍是 IME guard，未命中的组合一律返回 `null`，不 `preventDefault`。

默认值（与 R1 相同）：

```
bold Ctrl+B    italic Ctrl+I    link Ctrl+K
heading1..6 Ctrl+1..6
ol Ctrl+Shift+7    ul Ctrl+Shift+8
```

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

M1 R2: READY FOR MANUAL CLOSURE
