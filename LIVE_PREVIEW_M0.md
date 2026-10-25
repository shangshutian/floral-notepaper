# Live Preview M0 — 接入审计与基础框架

> **STATUS: PROTOTYPE VALIDATED / DEFERRED**
>
> 本文件仅作为**技术验证记录**保留。
> 技术路径已验证可行（CodeMirror 6 + 装饰式 Live Preview 可在现有架构上落地），
> 但完整 Live Preview 的长期编辑器维护成本与当前 Floral 产品定位不匹配 ——
> 一旦引入结构化编辑器，就要长期承担选区、IME、装饰、块级原子化、主题、
> 无障碍与三端渲染一致性等一整套维护责任，而收益只覆盖"少开一半屏幕"这一项。
> **现阶段继续采用 Split View**，产品模式保持 `编辑 | 分栏 | 预览`。
> 代码层面的 M0 实现已**整体回退**，仓库回到 M1.1 完成后的状态。
> 若未来重启，本文的架构审计、装饰设计约束（§6.3）与已知限制（§10）仍然有效。

> 目标：在顶部模式组 `编辑 | 分栏 | 预览` 中插入 `实时`，
> 用**同一区域可编辑实时渲染**（Obsidian Live Preview 语义）替代"编辑区 + 预览区"的叠加。
> 底层仍是标准 Markdown，不进入 Storage M2，不改 notes 存储，不做 Git 提交。

---

## 1. 结论

**原判定**：`LIVE PREVIEW M0: READY`
**最终状态**：`STATUS: PROTOTYPE VALIDATED / DEFERRED`

架构明确、风险可控，M0 基础框架曾经实现并通过类型检查 / 311 用例 / lint / 格式 / 构建。
未做的是需要人工在 WebView2 里确认的交互细节（见 §9）。

产品决定：**暂不维护 Live Preview**，继续使用现有 `编辑 | 分栏 | 预览`。
因此本次回退已删除 `src/features/livePreview/`、`ViewMode = "live"`、顶部「实时」入口、
Settings 默认视图「实时」、MainWindow 的 CM6 / Undo / Toolbar / ImagePaste 接入、
CodeMirror 依赖与三语言 `defaultView.live` 键。M1 / M1.1 的 Markdown 快捷键成果完整保留。

---

## 2. 现有架构审计

### 2.1 编辑链路（现状）

`MainWindow.tsx` 的正文编辑器是一个**受控 `<textarea>`**：

| 关注点          | 现状实现                                                         | 位置                         |
| --------------- | ---------------------------------------------------------------- | ---------------------------- |
| 内容真相        | React state `content` + `contentValueRef` 镜像                   | `MainWindow.tsx:178`         |
| 写入            | `setContent()`，全部改动只有一个入口                             | 全局                         |
| 脏标记          | `markDirty()` → `saveState = "dirty"`                            | `MainWindow.tsx:1421`        |
| 持久化          | 900ms 防抖 autosave → `saveCurrentNote()` → `updateNote`         | `MainWindow.tsx:1060-1083`   |
| Undo            | `document.execCommand("undo"/"redo")`，依赖浏览器原生 undo 栈    | `MainWindow.tsx:126`         |
| Markdown 快捷键 | document 级 `keydown`，`event.target === textarea` 才处理        | `useMarkdownShortcuts.ts:34` |
| Toolbar         | `applyMarkdownCommand()` → 一次 `execCommand("insertText")`      | `commands.ts:351`            |
| Tab             | `indent-textarea` 的 document 级监听，只认 `HTMLTextAreaElement` | `App.tsx:56-60`              |
| 图片粘贴        | `useImagePaste` → `insertTextAtCursor(textarea, …)`              | `useImagePaste.ts:42`        |
| 预览            | `react-markdown` + remark-gfm/math + rehype-katex/sanitize       | `MarkdownPreview.tsx`        |

关键既有契约（M1 建立，M0 不得破坏）：

1. **一次 command = 一条 undo 记录**，靠"最小替换区间 + 单次 `execCommand("insertText")`"实现；
2. **Toolbar 与快捷键共用 `computeMarkdownEdit()`**，不存在第二套字符串拼接；
3. **IME 保护**在 `resolveMarkdownShortcut` 入口（`isComposing || keyCode === 229`），且不 `preventDefault`；
4. 设置持久化只能走 `AppConfig`（Rust 侧 `load_config` 会整份重写，前端私有字段会被丢弃）。

### 2.2 模式切换现状

`ViewMode = "edit" | "split" | "preview"`，纯字符串，**Rust 侧只存 `default_view_mode: String`**，没有枚举校验
（`notes.rs:36`），所以新增 `"live"` 不需要改 Rust / 迁移配置。

渲染分支在 `MainWindow.tsx:2800-2884`：`key={viewMode}` 强制整块重挂载（带淡入动画），
`edit/split` 渲染 textarea，`split/preview` 渲染 `MarkdownPreview`，`split` 额外渲染拖拽分隔条。

### 2.3 NotePad（独立 WebView）

`NotePad.tsx` **没有视图切换**：单一 `<textarea>` 草稿板 + 900ms 自动保存 + Tile 只读渲染。
它复用了同一个 `useMarkdownShortcuts` 与 `useImagePaste`，但不涉及 ViewMode。

**M0 决策**：NotePad 保持原样（不引入模式切换与 CodeMirror），只保证共享模块改动向后兼容。
给它加实时模式属于产品决策，不在 M0 范围。

### 2.4 结论：为什么不能走 textarea + HTML overlay

- 选区 / 光标 / 滚动是两层坐标系，任何换行折叠都会让 overlay 与 textarea 错位；
- 隐藏 `**` 会改变字宽，textarea 无法"内容不变但显示变窄"，只能靠等宽字体 + 空白伪造，
  与现有 `font-body`（非等宽）+ 中英混排直接冲突；
- undo 仍然只能靠 `execCommand`，一旦隐藏了字符，`execCommand("insertText")` 的替换区间与用户看到的文本不再一致。

因此 M0 采用**结构化编辑器**方案，而不是给 textarea 打补丁。

---

## 3. 方案选型

| 方案                     | 判断 | 理由                                                                                                                                                                                  |
| ------------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CodeMirror 6（采用）** | ✅   | 文档/选区/撤销/输入法都是内建的一等公民；`Decoration.replace` 支持"折叠源码但仍是同一份文档"；`StateField` 可提供 block widget；bundle 可懒加载；与 React 集成只需一个受控包装        |
| ProseMirror / Tiptap     | ✗    | 模型是富文本树，需要 Markdown ↔ 树的**双向序列化**。用户文档里只要有它不认识的扩展语法（自定义 alert、frontmatter、LaTeX 块），round-trip 就会丢格式，与"底层保存标准 Markdown"硬冲突 |
| Milkdown                 | ✗    | 本质是 ProseMirror + 自己的 Markdown 序列化，同样有 round-trip 风险，且依赖链更重                                                                                                     |
| 自研 contenteditable     | ✗    | 等于自己重写 IME、撤销、选区归一化，风险最高                                                                                                                                          |
| textarea + HTML overlay  | ✗    | 见 §2.4                                                                                                                                                                               |

CM6 的关键契合点：**文档始终是纯 Markdown 字符串**，渲染只是"折叠某些区间"，
不存在源码与模型两份真相，因此不会破坏任何非标准语法。

依赖（`dependencies`）：

```
@codemirror/state    6.7.6
@codemirror/view     6.43.15
@codemirror/commands 6.11.1
@codemirror/language 6.13.1   （@codemirror/commands 的传递依赖，M0 未直接 import）
```

**没有**引入 `@codemirror/lang-markdown`：Live 的渲染规则来自自研扫描器（§4.2），
不需要 Lezer 语法树；少一个 parser 依赖，也避免"解析失败 ⇒ 整块不渲染"的降级问题。

---

## 4. 架构设计

### 4.1 数据流

```
MainWindow                LiveMarkdownEditor (CM6)                decorations.ts
---------                 ------------------------                --------------
content  ──value prop──▶  EditorState.doc
                          │  dispatch(transaction)
                          ▼
                        updateListener ──onChange──▶ setContent + markDirty
                                                        │
                                                        └─▶ 900ms autosave（未改动）

外部内容变化（切换笔记）──value prop──▶ dispatch({changes, annotations: [external, addToHistory:false]})
                                        （不触发 onChange，不进 undo 栈）
```

- **内容真相仍然是 `content`**：autosave、dirty、字数/字节统计、`cleanUnusedImages` 全部零改动；
- 模式切换时 `key={viewMode}` 整块重挂载，用当前 `content` 重建 `EditorState`；
- 同一份文档在两个模式下都能编辑，切回去内容不丢（都写同一个 state）。

### 4.2 扫描层（纯函数，可单测）

`scan.ts` 把 Markdown 文本切成两层：

- `LiveLine`：逐行信息（`kind`、`level`、`contentFrom`、`markerFrom`、`ordinal`）；
- `LiveRegion`：跨行块（`fence` / `math` / `table` / `hr`），带 `from/to/body/language`。

**不完整的块不产生 region**：没闭合的 ```或`$$` 一律降级成普通正文。
这条规则是刻意的 —— 否则用户刚敲下三个反引号，后面整篇笔记就被吞进代码块。

行内扫描 `scanInlineTokens()` 处理 `**` `*` `***` `__` `~~` `` ` `` `$…$` `[text](href)`，
带转义跳过、`snake_case` 保护、空壳（`****` / ` `` ` / `$$` / `[]()`）保护。

### 4.3 激活（展开源码）判定

| 层级                                  | 判定                        | 效果                                                                          |
| ------------------------------------- | --------------------------- | ----------------------------------------------------------------------------- |
| 块级标记（`#` `>` `-` `1.`）          | 选区与**整行**相交          | 光标进入该行即展开标记                                                        |
| 行内元素（`**` 等）                   | 选区与该 **token 区间**相交 | 只展开被点中的那一个元素，同行其它元素保持渲染                                |
| 跨行块（围栏 / 公式 / 表格 / 分割线） | 选区与**整块**相交          | 光标在块内 → 整块源码；点击渲染结果 → CodeMirror 把光标落到块首/尾 → 立即展开 |

行内粒度做到 token 级，是为了避免"点行尾就把行首粗体展开"这种 Obsidian 不会有的行为。

### 4.4 装饰与 widget

`decorations.ts` 用一个 `StateField` 一次性产出两套 RangeSet：

- `decorations`：`HIDE`（`Decoration.replace({})`）+ `mark`（strong/em/strike/code/link）+ `line`（h1-h6/quote/ul/ol）
  - `block replace`（fence/math/table/hr 的 widget）；
- `atomic`：**只含被折叠掉的区间**，用于 `EditorView.atomicRanges`，让光标横向移动整体跳过被隐藏的 `**`。

> 注意：`EditorView.decorations.of(view => …)` 会把这个源标记成 dynamic，
> 而 dynamic 源里的 **block decoration 会直接抛** `Block decorations may not be specified via plugins`。
> 所以必须用 `EditorView.decorations.compute([field], state => …)` 提供**静态值**。
> 这条不变量有专门的单测守着（`decorations.test.ts` › "decoration 源必须是静态值"）。

widget（`widgets.ts`）：`InlineMathWidget` / `BlockMathWidget`（KaTeX）、`CodeBlockWidget`（语言标签 + `<pre>`）、
`TableWidget`（thead/tbody）、`HorizontalRuleWidget`。
所有 widget 的 `ignoreEvent()` 返回 `false`，把鼠标事件交回 CodeMirror，点击即可回到源码态。

### 4.5 Command / 快捷键 / Undo

- Toolbar：`handleToolbarAction()` 按模式分流，live 走 `handle.applyCommand(action)`；
- 快捷键：CM6 的 `EditorView.domEventHandlers({ keydown })` 调用**同一个**
  `resolveMarkdownShortcut(event, bindings)`，命中后 `applyMarkdownCommandToView()`
  → `computeMarkdownEdit()` → 一次事务。与 textarea 路径共享纯函数与绑定表（含 Settings 自定义键）；
- document 级的 `useMarkdownShortcuts` 在 live 模式被 `enabled: false` 关掉，避免双触发；
- Undo/Redo：CM6 `history()` + `historyKeymap`（Windows 上 `Mod-z` / `Mod-y`，与既有 tooltip 的 `Ctrl+Y` 一致）；
  顶栏按钮 `handleUndo/handleRedo` 按模式分流；
- IME：`resolveMarkdownShortcut` 的 `isComposing || keyCode === 229` 保护继续生效，且不 `preventDefault`；
- Tab / Shift-Tab：`editorCommands.ts` 自实现"逐行加/去一级缩进"，宽度取 `AppConfig.tabIndentSize`
  （刻意不用 `indentWithTab`，它依赖 `@codemirror/language` 的 `indentUnit` facet）。

---

## 5. 修改文件

新增 `src/features/livePreview/`：

| 文件                                                              | 职责                                                  |
| ----------------------------------------------------------------- | ----------------------------------------------------- |
| `scan.ts`                                                         | 纯函数：块级 / 行内扫描                               |
| `decorations.ts`                                                  | StateField + 装饰生成 + 扩展导出                      |
| `widgets.ts`                                                      | KaTeX / 代码块 / 表格 / 分割线 widget                 |
| `theme.ts`                                                        | CM6 主题（全部引用 `--color-*` 变量，自动跟随深浅色） |
| `editorCommands.ts`                                               | command → 事务；Tab/Shift-Tab 缩进                    |
| `LiveMarkdownEditor.tsx`                                          | React 包装 + 受控同步 + 命令式 handle                 |
| `LiveMarkdownEditorLazy.tsx`                                      | 懒加载入口                                            |
| `scan.test.ts` / `decorations.test.ts` / `editorCommands.test.ts` | 48 个用例                                             |

改动既有文件：

| 文件                                               | 改动                                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------------------- |
| `src/features/settings/types.ts`                   | `ViewMode` 增加 `"live"`                                                        |
| `src/features/settings/api.ts`                     | `normalizeViewMode` 接受 `"live"`                                               |
| `src/components/SettingsPanel.tsx`                 | 默认视图下拉增加「实时」                                                        |
| `src/components/MainWindow.tsx`                    | 顶部模式组、编辑区 live 分支、Toolbar/Undo 分流、快捷键 `enabled`、图片粘贴接入 |
| `src/features/images/useImagePaste.ts`             | 新增可选 `insertMarkdown`；事件类型放宽到 `HTMLElement`                         |
| `src/locales/{zh-CN,en-US,zh-HK}/translation.json` | `settings.defaultView.live`                                                     |
| `package.json` / `package-lock.json`               | 三个 `@codemirror/*` 依赖                                                       |

**未改动**：`src-tauri/**`（`defaultViewMode` 本来就是 `String`）、`notes` 存储、`NotePad.tsx`。

---

## 6. 阶段划分

| 阶段           | 内容                                                                                     | 状态    |
| -------------- | ---------------------------------------------------------------------------------------- | ------- |
| **M0（本次）** | 模式位、CM6 接入、受控同步、装饰骨架、§2.1 全部既有契约保持                              | ✅ 完成 |
| M1             | 表格单元格内编辑（点单元格而不是整块进源码）、Enter 自动续列表、任务列表 checkbox        | 待排    |
| M2             | 图片 `![]()` 渲染（复用 `MarkdownPreview` 的 `resolveMarkdownImageSrc`）、代码块语法高亮 | 待排    |
| M3             | 嵌套行内（`**a *b* c**` 内层）、引用块内多行整体展开                                     | 待排    |
| M4             | 装饰的视口裁剪（当前整篇重算，>300K 字符降级）                                           | 待排    |

---

## 7. 风险与缓解

| #   | 风险                                                 | 现状                                                                                                                 |
| --- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1   | 装饰在每次 doc/selection 变化时整篇重算              | 常规笔记 O(行数) 扫描，实测用例毫秒级；>300,000 字符直接 `Decoration.none` 降级为纯文本，保证不卡死。视口裁剪留到 M4 |
| 2   | block widget 点击落点只能精确到块首/尾               | CM6 的 `posAtCoords` 对被替换区间只能给边界。块随即展开，用户再用方向键定位 —— 与 Obsidian 的行为一致                |
| 3   | 两套 undo 栈（textarea 原生 / CM6 history）          | 模式切换本来就 `key={viewMode}` 重挂载，undo 历史不跨模式继承（与现在 edit↔preview 切换的语义一致）                  |
| 4   | `****` 空行按 CommonMark 就是分割线                  | 光标在行内时不折叠；失焦后渲染为 `<hr>`，与 `react-markdown` 预览结果一致。已有用例显式记录该行为                    |
| 5   | `Ctrl+Shift+Z` 仍是原生 Redo                         | 未占用（M1.1 已裁决）；CM6 `historyKeymap` 在 Windows 绑 `Mod-y`，与 tooltip 一致                                    |
| 6   | 行内 widget 是 atomic，Backspace 会整段删除          | 与"折叠即原子"的语义一致；要改内容就点进去（展开后按字符编辑）                                                       |
| 7   | KaTeX 在 widget 内渲染，字号跟随正文                 | 与 `MarkdownPreview` 的 KaTeX 走同一份 CSS（`vendor-katex` chunk 复用）                                              |
| 8   | 快捷键 `Ctrl+Shift+A/W` 在 WebView2 可能被浏览器抢占 | 与 M1.1 遗留项相同，需要实机确认；用户可在 Settings 改绑                                                             |

---

## 8. 验证记录

| 项                                   | 结果                                                                                |
| ------------------------------------ | ----------------------------------------------------------------------------------- |
| `npx tsc --noEmit`                   | PASS                                                                                |
| `npx vitest run`                     | **31 文件 / 311 用例全过**（新增 48：scan 18 / decorations 20 / editorCommands 10） |
| `npx oxlint src`                     | 97 文件，0 warning / 0 error                                                        |
| `npx oxfmt --check`                  | 新增与改动文件全部 clean（仅仓库原有的 3 个未跟踪 md 未格式化）                     |
| `npx vite build --outDir <临时目录>` | PASS                                                                                |

构建产物（懒加载生效，既有模式 bundle 不变大）：

```
index-DKn2af1M.js              234.76 kB │ gzip:  72.30 kB   ← 主窗口（未含 CM6）
LiveMarkdownEditor-*.js        290.21 kB │ gzip:  93.93 kB   ← 仅进入「实时」时下载
MarkdownPreview-*.js           330.80 kB │ gzip: 100.33 kB   ← 未变
vendor-katex-*.js              288.18 kB │ gzip:  87.55 kB   ← 实时/预览共用
```

---

## 9. 待人工验收（代码无法覆盖的部分）

1. 进入「实时」后：标题 / 粗体 / 列表 / 引用 / 链接 / 行内代码 / 行内公式 / 代码块 / 块级公式 / 表格 / 分割线的渲染观感与深色主题；
2. 光标进出每个元素的源码展开/收起是否跟手（尤其块 widget 的点击落点）；
3. 中文 IME 组合期间按 `Ctrl+Shift+*` 不应触发任何 command；
4. 切换笔记时 live 编辑器不应把状态标成「未保存」（`addToHistory:false` + annotation 抑制路径）；
5. 900ms autosave 在 live 模式下的实际落盘与状态栏流转；
6. `Ctrl+Shift+A` / `Ctrl+Shift+W` 在 WebView2 里的实际行为（浏览器快捷键可能抢占）；
7. 长文档（>2000 行）连续输入的流畅度；
8. NotePad 与 Tile 窗口回归：共享的 `useImagePaste` 签名变化不应影响它们。

---

## 10. 已知限制（M0 明确不做）

- 图片 `![](…)` 仍显示源码（不渲染缩略图）；
- 表格只能整块展开为源码编辑，不能点单元格；
- 列表回车不自动续 `- `；
- 任务列表 `- [ ]` 在 live 模式不可勾选（预览模式仍可）；
- 代码块无语法高亮，只有语言标签 + 等宽样式；
- 嵌套行内（粗体内再斜体）内层保持源码；
- `Ctrl+Shift+Z` 不作为可绑定键（native Redo）。

---

## 11. 最终报告

`STATUS: PROTOTYPE VALIDATED / DEFERRED`

技术验证结论保持 `READY`（架构可行、风险可控、M0 框架可运行），
但产品结论为 **DEFERRED**：完整 Live Preview 的长期编辑器维护成本与当前 Floral 产品定位不匹配，
现阶段继续采用 Split View，代码已回退，仓库位于 M1.1 完成后的状态。

---

## 12. 回退记录（Rollback Log）

执行原则：**只撤销 Live Preview M0 引入的代码变化**，M1 / M1.1 成果零改动；
不使用 `git reset --hard`，不使用整体 `git checkout`。

### 12.1 已撤销

| 项目                        | 处理                                                                                                                             |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `src/features/livePreview/` | 整目录删除（含 `scan` / `decorations` / `widgets` / `theme` / `editorCommands` / `LiveMarkdownEditor` 及 3 个测试）              |
| `ViewMode = "live"`         | `settings/types.ts` 回到 `"edit" \| "split" \| "preview"`                                                                        |
| `normalizeViewMode`         | 去掉 `"live"` 分支，`settings/api.ts` 与 `api.test.ts` 完全回到 HEAD                                                             |
| 顶部「实时」模式            | `MainWindow` 模式组删除 `live` 项，工具栏区域条件回到 `edit \| split`                                                            |
| Settings 默认视图「实时」   | `SettingsPanel` 删除 `live` 选项                                                                                                 |
| Live Editor 接入            | 删除 `LiveMarkdownEditorLazy` / `LiveMarkdownEditorHandle` 导入、`liveEditorRef`、JSX 双分支，textarea 唯一路径恢复              |
| Undo / Redo 分流            | `handleUndo` / `handleRedo` 去掉 `viewMode === "live"` 分支                                                                      |
| Toolbar 分流                | 删除 `handleToolbarAction`，`onClick` 回到内联 `applyMarkdownCommand(...)`                                                       |
| 快捷键 `enabled` 抑制       | 删除 `enabled: viewMode !== "live"`（`enabled` 默认 `true`，行为与 M1.1 一致）                                                   |
| Image Paste                 | `useImagePaste` 单文件恢复到 HEAD：删除 `insertMarkdown` 选项、事件类型回到 `HTMLTextAreaElement`                                |
| CodeMirror 依赖             | `npm uninstall @codemirror/{state,view,commands,language}`，`package.json` 与 `package-lock.json` 均回到 HEAD（`git diff` 为空） |
| 三语言 locale               | 删除 `settings.defaultView.live`（zh-CN `实时` / en-US `Live` / zh-HK `實時`）                                                   |

### 12.2 保留不动（M1 / M1.1）

- `features/markdown/`：`commands.ts`（8 个 command → 13 个）、`shortcuts.ts`、`shortcutBindings.ts`、`useMarkdownShortcuts.ts`、`useMarkdownShortcutBindings.ts` 及全部测试；
- `features/settings/MarkdownShortcutsSection.tsx` 的录制 / 冲突 / Reset UI；
- 三语言 `settings.markdownShortcuts.action.*` 新增的 5 个键（`inlineCode` / `codeBlock` / `inlineMath` / `blockMath` / `table`）；
- 默认键表（`ul: Ctrl+Shift+1`、`ol: Ctrl+Shift+2`、`inlineCode: Ctrl+Shift+Q`、`codeBlock: Ctrl+Shift+W`、`inlineMath: Ctrl+Shift+S`、`blockMath: Ctrl+Shift+A`、`table: Ctrl+Shift+B`）；
- M1.1 的无选区示例文本移除、`translate: TFunction` 参数删除；
- `M1_Markdown_Shortcuts.md` 报告全文。

### 12.3 回退后验证

| 项目            | 结果                                                                                      |
| --------------- | ----------------------------------------------------------------------------------------- |
| `git diff`      | 15 文件 / +1031 −134，全部属于 M1.1 + 报告；`package*.json`、`settings/*` 无差异          |
| `tsc --noEmit`  | PASS                                                                                      |
| `vitest`        | **28 文件 / 263 用例全过**（与 M1.1 收口基线一致，Live Preview 的 48 条测试已随目录删除） |
| `oxlint src`    | PASS，87 文件 0 warning 0 error（回退前 97 文件）                                         |
| `oxfmt --check` | clean，94 文件                                                                            |
| `vite build`    | PASS，主 chunk 233.62 kB；无 Live chunk，`MarkdownPreview` 独立 chunk 仍在                |
| UI 模式组       | `编辑 \| 分栏 \| 预览`（MainWindow 与 SettingsPanel 都只剩三项）                          |
| M1.1 快捷键     | 13 个 command + 默认键表完整（`Ctrl+Shift+1/2/Q/W/S/A/B` 全在）                           |

### 12.4 说明

回退后 UI 模式组恢复为 `编辑 | 分栏 | 预览`，M1.1 新增快捷键（行内代码 / 代码块 / 行内公式 / 块级公式 / 表格）
与自定义绑定、undo 选区修复全部保持可用。

未 commit。工作区 untracked 项：`LIVE_PREVIEW_M0.md`（本记录）、`M0_Architecture_Audit.md`、`.workbuddy/`。
