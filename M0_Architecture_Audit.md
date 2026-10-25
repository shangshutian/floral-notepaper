# M0 Architecture Audit — Floral Notepaper（个人定制开发）

- 仓库：`floral-notepaper`
- 审计分支：`dev`（HEAD `23e6df7`，`main` 为上游稳定基线 `origin/main`）
- 版本：`1.2.0`（`package.json:3`、`src-tauri/tauri.conf.json:4`、`src-tauri/Cargo.toml:3` 三处一致）
- 审计性质：只读静态审计。**本轮未修改任何源码，未执行任何 Git 写操作。**
- 目标：M1（Markdown 快捷键）、M2（Filesystem-friendly 笔记仓库）、Windows 独立分发

---

## 1. Executive Summary

### 1.1 技术栈结论

Tauri 2 + React 19 + TypeScript + Vite + Tailwind 4 的**纯本地桌面应用**。没有数据库、没有服务端、没有网络同步；唯一持久化形态是「JSON 侧车元数据 + 磁盘上的 .md 文件 + 图片目录」。

- 前端：React 19.1 + TS 5.8 + Vite 8 + Tailwind 4 + i18next（`package.json:17-54`）
- Markdown 渲染：`react-markdown` + `remark-gfm` / `remark-math` / `rehype-katex` / `rehype-raw` / `rehype-sanitize` / `rehype-slug`（`package.json:24-36`，`src/features/markdown/MarkdownPreview.tsx:1-17`）
- 后端：Rust（Tauri 2，`src-tauri/Cargo.toml:23-41`），45 个 `invoke` 命令（`src-tauri/src/lib.rs:470-516`）
- 存储层：`src-tauri/src/services/notes.rs`（2452 行，`NoteStore`），无 ORM、无 SQLite

### 1.2 三个最关键的发现

**发现 1（M1 利好）：格式逻辑已经是"单一实现"，但只存在于组件文件内部。**

`applyFormat(textarea, action, t, setContent, markDirty)` 是 `MainWindow.tsx` 内的模块级函数（`src/components/MainWindow.tsx:136-304`），签名与 React 状态解耦，`FormatAction` 是闭合枚举（`MainWindow.tsx:124-134`）。Toolbar 10 个按钮只是把 `action` 传进去（`MainWindow.tsx:2946-2968`）。

因此"Toolbar 与 Shortcut 不形成两套格式逻辑"在架构上**天然成立**——前提是把该函数搬到 `src/features/markdown/` 并让快捷键调用同一入口，而不是复制一份。**但不能直接接快捷键**，因为它有 3 个硬约束（见 §4.3）：依赖原生 undo 栈、通过 `execCommand("insertText")` 整篇替换、`heading` 语义是"循环升一级"而非"设为 N 级"。

**发现 2（M2 关键）：文件名其实已经"半可读"，真正的阻塞不是 UUID 前缀，而是"单层分类 + 元数据反向依赖文件名推断 identity"。**

当前文件名格式是 `{uuid}_{安全化标题}.md`（`notes.rs:1322-1329`），例如 `0f3c1b8e-...._2025阅读A.md`。同时：

- `id_from_file_name()` 从文件名的**第一个 `_` 之前**反推 ID（`notes.rs:1624-1631`）
- `rebuild_metadata()` 只在 `metadata.json` 缺失/损坏/为空时才全盘重建（`notes.rs:1284-1299`、`1331-1360`），重建时 `created_at` 退化为文件 mtime（`notes.rs:1424-1436`）

这意味着**identity 存在"双语义"**：正常路径靠 `metadata.json` 的 `id` 字段，灾难恢复路径靠文件名推断。任何"把 UUID 从文件名里删掉"的改动，如果不先解决这一点，会直接导致重建后 ID 全部漂移。

第二个阻塞是**目录层级**：`notes/<category>/<file>.md` 只支持一层（`notes.rs:1305-1312`），`list_categories()` 只读顶层目录（`notes.rs:980-992`），`rebuild_metadata()` 只扫顶层 + 一层子目录（`notes.rs:1386-1403`）。目标形态 `英语/阅读/2025阅读A.md` 这种**两级分类目前会直接导致笔记从列表消失**（文件在盘上，但不在 metadata 里）。

**发现 3（分发利好 + 一个真实陷阱）：Tauri 打包天然满足"用户不需要装 Node/Rust"，但本机当前无法构建。**

前端在 `tauri build` 时被打进二进制（`frontendDist: "../dist"`，`tauri.conf.json:10`），产出的 `floral-notepaper.exe` 是自包含的可执行文件；终端用户只需要 WebView2 运行时（Win11 自带，本机已存在 `145.0.3800.97`），**不需要 Node、不需要 Rust、不需要 MSVC**。

陷阱：本机**没有 Rust 工具链**（`cargo`/`rustup` 不存在，`~/.cargo` 不存在），且 `node_modules` 缺失。所以"能否生成 EXE"的答案是"架构上能，当前环境不能，需先装 Rust + MSVC Build Tools"（详见 §10.4）。

第二个陷阱：内置更新器默认指向**上游仓库** `Achilng/floral-notepaper`（`src-tauri/src/updater/check.rs:25-26`）。个人定制版若不改这个配置，会被静默升级成上游二进制，M1/M2 的定制全部丢失。这是 P0 级别的分发风险，不是 M2 才需要考虑的事。

### 1.3 结论

- **M1 可行度高**：改动集中在 1 个文件（把 `applyFormat` 提取为模块）+ 1 个快捷键层 + 3 个 locale 文件。无需触碰 Rust。
- **M2 可行，但必须分阶段**：不是"把 UUID 改成标题"，而是「目录层级扩展 + 文件名策略 + identity 收敛为单一来源 + 外部修改对账」四件事，其中目录层级是硬前提。
- **Windows 分发可行**：目标形态应为 `portable EXE`（免安装）+ 可选 NSIS 安装包；必须处理 WebView2 离线安装模式与更新器指向。

---

## 2. Architecture Map

### 2.1 进程与窗口模型

单个 HTML 入口 `index.html`，通过 query string 切成 3 种视图（`src/features/windows/windowRoutes.ts:26-33`）：

| 视图    | URL                                | 用途                       | 组件                        |
| ------- | ---------------------------------- | -------------------------- | --------------------------- |
| main    | `index.html`                       | 主窗口：列表 + 编辑 + 预览 | `MainWindow.tsx`（3277 行） |
| notepad | `index.html?view=notepad&noteId=…` | 便签小窗（窗口池复用）     | `NotePad.tsx`（934 行）     |
| tile    | `index.html?view=tile&noteId=…`    | 桌面磁贴（只读预览/复制）  | `Tile.tsx`（157 行）        |

每个窗口是**独立的 WebView + 独立 React 树**，通过 Tauri 事件总线跨窗口同步：

- `notes-changed`：Rust 在增删改后广播（`src-tauri/src/lib.rs:31,38,45`），前端监听刷新（`MainWindow.tsx:648-653`、`NotePad.tsx:238-245`）
- `config-changed`：`config_save` 后广播（`lib.rs:266`），主题/字号/语言热更新（`App.tsx:43-61`）
- `open-external-file` / `open-note` / `notepad:activate` / `tile-window-*`：窗口与文件路由

窗口 label 内嵌 note id（`desktop.rs:1879-1885`：`notepad-{id}` / `tile-{id}`），**这是 ID 稳定性对 UI 的硬依赖**（见 §9）。

### 2.2 前端目录职责

```
src/
  components/        MainWindow / NotePad / Tile / SettingsPanel / AboutPanel / Toast / ContextMenu
  features/
    notes/           api.ts（invoke 封装）、types.ts、noteUtils.ts（分组/过滤/字数）、noteContextMenu.ts
    markdown/        MarkdownPreview、scrollSync、imageSrc、remarkAlerts、rehypeTaskLists
    images/          api.ts、useImagePaste.ts、useImageBaseDir.ts
    importExport/    api.ts（dialog + invoke）
    settings/        api.ts、types.ts、theme.ts、shortcutRecorder.ts、useShortcutRecorder.ts
    update/          api.ts、presentation.ts、updateErrors.ts
    windows/         api.ts、controls.ts、surfaceMode.ts、surfaceActions.ts、noteSurfaceSavePolicy.ts
  locales/           zh-CN / en-US / zh-HK（键位一致性有测试守护）
```

### 2.3 后端目录职责

| 文件                              | 职责                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------ |
| `src-tauri/src/main.rs`           | 入口，调用 `lib::run()`                                                              |
| `src-tauri/src/lib.rs`            | Tauri Builder、45 个命令注册、插件装配                                               |
| `src-tauri/src/services/notes.rs` | **全部存储逻辑**：`AppConfig`、`Note`、`NoteMetadata`、`NoteStore`、迁移、分类、图片 |
| `src-tauri/src/desktop.rs`        | 窗口池/磁贴/托盘/全局快捷键/IME 热键钩子（2815 行）                                  |
| `src-tauri/src/updater/*`         | 自更新（检查、下载、安装、镜像 CDK、调度）                                           |
| `src-tauri/src/json_io.rs`        | `write_json_atomic`：写临时文件 → `sync_all` → `rename`（`json_io.rs:10-28`）        |

**没有数据库**。全部状态 = `config.json`（配置目录）+ `metadata.json`（数据目录）+ `notes/` + `images/` + `backgrounds/`。

### 2.4 磁盘布局（当前）

```
<config_dir>/                      Windows: %APPDATA%\floral-notepaper
  config.json                      AppConfig（含绝对路径 dataDir、backgroundImagePath）

<data_dir>/                        Windows 默认: %USERPROFILE%\Documents\花笺
  metadata.json                    Vec<NoteMetadata>，唯一权威元数据
  notes/                           笔记根
    <uuid>_<title>.md              未分类
    <category>/<uuid>_<title>.md   单层分类
  images/<noteId>/<uuid>.<ext>     附件，按 note ID 分目录
  backgrounds/bg-<uuid>.<ext>      背景图
```

`data_dir` 解析优先级：`FLORAL_NOTEPAPER_DATA_DIR` 环境变量 → `config.json` 的 `dataDir` → 旧配置 `notesDir` 推导 → `Documents/花笺`（`notes.rs:241-313`）。

注意：UI 里"选择文件夹"并不会直接用你选的目录，而是**再套一层 `floral`**（`lib.rs:273`：`PathBuf::from(&new_data_dir).join("floral")`）。实际笔记路径是 `<你选的目录>/floral/notes/…`。

### 2.5 主要数据流

**读取列表**

```
MainWindow bootstrap (MainWindow.tsx:718-760)
  → invoke("notes_list") → lib.rs:19 notes_list()
  → NoteStore::list_notes() (notes.rs:739-748)
      load_metadata()           读 metadata.json（缺失/损坏则 rebuild）
      retain(路径存在)           ← 关键：文件被外部删除/改名即从列表消失
      sort by updated_at desc
  → invoke("categories_list") → list_categories() (notes.rs:980-992) 只读顶层目录
```

**打开/编辑/保存**

```
选中笔记 → invoke("notes_get", id) → find_metadata(id) + read_to_string(path)
输入 → setContent + markDirty → saveState="dirty"
900ms 防抖 (MainWindow.tsx:1240-1263) → performSave() (1126-1176)
  → invoke("notes_update", {id, request}) → update_note() (notes.rs:807-863)
      file_name = file_name_for(id, title)     ← 标题变则文件名变
      写新路径 → 保存 metadata.json → 旧路径移入回收站
  → emit("notes-changed") → 所有窗口 refreshNotes()
```

**注意**：`note_auto_save` 与 `note_surface_auto_save` 是两条独立开关（`notes.rs:37-40`），主窗口用前者（`MainWindow.tsx:1243-1246`），便签窗用后者（`NotePad.tsx:680-691`）。

---

## 3. Markdown Editor / Toolbar Data Flow

### 3.1 Editor 实现：原生 `<textarea>`（不是富文本，不是 CodeMirror）

主编辑器：`MainWindow.tsx:2971-2993`

```tsx
<textarea
  ref={contentRef}
  data-tab-indent="true"
  value={content}
  onChange={(e) => {
    setContent(e.target.value);
    markDirty();
  }}
  onPaste={imagePasteHandler}
  onDrop={imageDropHandler}
  onScroll={handleEditorScroll}
  spellCheck={false}
  disabled={!selectedId}
/>
```

便签编辑器：`NotePad.tsx:874-900`（同构，多一个 ArrowUp 回标题框的逻辑 `NotePad.tsx:885-896`）。

结论与影响：

- 没有 AST、没有装饰层、没有语法高亮。**所有格式操作都是对字符串做区间拼接**。
- Undo/Redo 完全依赖 Chromium 原生的 textarea undo 栈。这是 M1 最重要的不可破坏约束。
- 三个"编辑面"里只有 2 个真正可编辑（main / notepad），`Tile` 只读（`Tile.tsx:125-130`），所以 M1 只需覆盖 2 处。

### 3.2 Toolbar 数据结构

`toolbarButtons`（`MainWindow.tsx:482-548`）是 `{label, title, style, action}` 的数组，10 项：

| label | action     | i18n key                  |
| ----- | ---------- | ------------------------- |
| B     | bold       | `main.toolbar.bold`       |
| I     | italic     | `main.toolbar.italic`     |
| H     | heading    | `main.toolbar.heading`    |
| —     | hr         | `main.toolbar.hr`         |
| •     | ul         | `main.toolbar.ul`         |
| 1.    | ol         | `main.toolbar.ol`         |
| <>    | code       | `main.toolbar.code`       |
| ❝     | quote      | `main.toolbar.quote`      |
| ∑     | inlineMath | `main.toolbar.inlineMath` |
| ∫     | blockMath  | `main.toolbar.blockMath`  |

渲染（`MainWindow.tsx:2946-2968`）时 `onMouseDown={e => e.preventDefault()}`，目的是**避免按钮夺走 textarea 焦点导致 selection 丢失**。这一行是 toolbar 能正确工作的关键，M1 的快捷键实现也必须保证"焦点始终在 textarea"。

### 3.3 `applyFormat` 内部机制（逐段）

`MainWindow.tsx:136-304`：

```ts
const { selectionStart: start, selectionEnd: end, value } = textarea;   // 143
const selected = value.slice(start, end);
const before = value.slice(0, start);  const after = value.slice(end);
const lineStart = before.lastIndexOf("\n") + 1;                        // 148 当前行起点
const currentLine = before.slice(lineStart);
switch (action) { ... }   // 计算 result / cursorStart / cursorEnd

const previousScrollTop = textarea.scrollTop;                          // 294
textarea.focus();
textarea.setSelectionRange(0, value.length);                           // 296 全选
document.execCommand("insertText", false, result);                     // 297 整篇替换
setContent(result);                                                    // 298 同步 React 状态
markDirty();                                                           // 299
requestAnimationFrame(() => { textarea.setSelectionRange(cursorStart, cursorEnd);
                              textarea.scrollTop = previousScrollTop; }); // 300-303
```

三个必须理解的设计：

1. **整篇替换而不是局部替换**：`setSelectionRange(0, len)` + `insertText` 让整次格式化只产生**一个 undo 条目**。如果改成"局部 splice + setContent"，textarea 的原生 undo 栈就会与 React state 脱节（React 受控值回写会破坏浏览器 undo 记录），Ctrl+Z 直接失效。
2. **`execCommand` 已废弃但仍是唯一可行路径**：`document.execCommand("insertText")` 在 WebView2（Chromium）里仍可用，且是唯一能同时"改动 DOM + 写入原生 undo 栈"的 API。`runEditorCommand()`（`MainWindow.tsx:306-310`）同理，用 `execCommand("undo"|"redo")` 而不是自己维护历史栈。
3. **cursor 恢复放在 rAF**：因为 `execCommand` 的 selection 变更与 React 重渲染存在时序差，同步设置会被覆盖。

### 3.4 各 action 的语义细节（对 M1 至关重要）

| action                 | 选区为空                                     | 有选区                        | 多行选区       | 反选（toggle off）      |
| ---------------------- | -------------------------------------------- | ----------------------------- | -------------- | ----------------------- |
| bold                   | 插入占位符 `粗体文本` 并选中                 | `**sel**`                     | 同左（不逐行） | ❌ 无                   |
| italic                 | 占位符 `斜体文本`                            | `*sel*`                       | 同左           | ❌ 无                   |
| heading                | 有前缀则升一级（`#{1,5}`→`#`），否则加 `## ` | 加 `## ` 前缀                 | —              | ❌ 无                   |
| hr                     | 插入 `---`（自动补换行）                     | —                             | —              | —                       |
| ul / ol                | `- 列表项` / `1. 列表项`                     | 前缀                          | **逐行加前缀** | ❌ 无（不检测已有前缀） |
| code                   | 占位符                                       | 单行 `\`x\``，多行 → ``` 围栏 | 围栏           | ❌ 无                   |
| quote                  | 占位符                                       | `> x`                         | 逐行 `> `      | ❌ 无                   |
| inlineMath / blockMath | `$E=mc^2$` / `$$\n…\n$$`                     | 包裹                          | —              | ❌ 无                   |

**M1 直接冲突点**：`heading` 的语义是"循环升一级"（`MainWindow.tsx:172-199`），无法表达 `Ctrl+1 → H1`。所以 Ctrl+1~6 **不能复用** `heading`，必须新增 `setHeadingLevel(level)` 语义，同时保持现有 H 按钮行为不变（否则是行为回退）。

**M1 缺失能力**：没有 `link` action（`FormatAction` 里不存在）。Ctrl+K 需要新增，且需要处理"选中文字 → `[sel](url)`"与"无选中 → `[](url)` 且光标落在 url 位置"两种形态。

### 3.5 Selection / Cursor 的唯一来源

`textarea.selectionStart` / `selectionEnd`（`MainWindow.tsx:143`）。没有独立的 selection model，没有 range 抽象。

这意味着：

- 快捷键实现**必须在 textarea 聚焦时读取**，且**在 React 重渲染前**读取（不能延后到 `requestAnimationFrame` 再读）。
- 便签窗的 `contentRef`（`NotePad.tsx:148`）与主窗的 `contentRef`（`MainWindow.tsx` 内同名 ref）是两套独立 ref，不能共享。

### 3.6 Undo / Redo 现状

- 唯一入口：`handleUndo` / `handleRedo`（`MainWindow.tsx:1654-1670`）→ `runEditorCommand(contentRef.current, "undo"|"redo")` → 成功后 `setContent(textarea.value)` + `markDirty()`
- 按钮：`MainWindow.tsx:2751-2795`，tooltip 分别是"撤销（Ctrl+Z）"/"重做（Ctrl+Y）"
- **没有 JS 层的 keydown 绑定**：Ctrl+Z / Ctrl+Y 走 WebView 原生行为，`NotePad` 更完全没有撤销入口（`NotePad.tsx` 无 undo 相关代码）
- 后果：**原生 undo 栈是唯一真相**。任何绕过 `execCommand` 的内容修改都会让 undo 栈与 UI 状态不一致。

---

## 4. Shortcut Integration Points

### 4.1 现有全部键盘监听（无遗漏）

| 位置                             | 触发条件                                         | 行为                                     | 阶段               |
| -------------------------------- | ------------------------------------------------ | ---------------------------------------- | ------------------ |
| `MainWindow.tsx:1228-1238`       | `(ctrl\|meta)+s`                                 | 强制保存                                 | document bubble    |
| `NotePad.tsx:565-575`            | `(ctrl\|meta)+s`                                 | 保存                                     | document bubble    |
| `App.tsx:53-63`                  | `Tab`，目标为 `textarea[data-tab-indent="true"]` | `tabToIndentListener`（indent-textarea） | **window capture** |
| `MainWindow.tsx:1076-1086`       | `Escape`                                         | 关闭右键菜单                             | document bubble    |
| `ContextMenu.tsx:63,104`         | `ctrl + 右键`                                    | 磁贴 ctrl 关闭                           | document           |
| `App.tsx:66-80`                  | `Alt+Space`（仅 Windows）                        | 阻止系统菜单                             | document capture   |
| `useShortcutRecorder.ts:106-188` | 录制全局快捷键时拦截全部按键                     | 设置页专用                               | document           |

**关键观察**：`Ctrl+B` / `Ctrl+I` / `Ctrl+1..6` / `Ctrl+K` **当前完全没有绑定**，不存在冲突。唯一需要小心的交集是 `Tab`（capture 阶段已处理缩进，M1 若引入 Ctrl+Tab 类组合需确认不冲突）。

### 4.2 平台差异

- Windows 上**没有原生菜单加速键**：`build_app_menu` 只在 macOS 编译（`desktop.rs:769`），`refresh_app_menu` 在非 macOS 是 no-op（`desktop.rs:876-880`）。所以不会出现"菜单先吃掉 Ctrl+B"的问题。
- `metaKey` 分支对 Windows 无意义，但现有代码统一写成 `ctrlKey || metaKey`，M1 沿用即可。

### 4.3 M1 必须处理的 3 个技术陷阱

**陷阱 1：IME 组合态**

中文输入法组合期间按 Ctrl+B（例如某些输入法的候选框内快捷键），`keydown` 的 `event.key` 可能是 `"Process"` 或 `"Unidentified"`，且直接操作 textarea 会**强制提交/破坏当前 composition**。必须守卫：

```ts
if (event.isComposing || event.keyCode === 229) return;
```

现有代码库**没有任何 `isComposing` 检查**（全库搜索无结果），这是一个新增职责，不能指望上游。

**陷阱 2：受控组件 + execCommand 的时序**

`content` 是 React state，`textarea` 是受控的。`execCommand` 改 DOM 会触发一次 `onChange`，然后 `setContent(result)` 再改 state，两次渲染。M1 若在快捷键里直接 `setContent(...)` 而不走 `execCommand`，会：

- 丢失 undo 条目（Ctrl+Z 无法撤销格式化）
- 光标位置被 React 重置到末尾

**陷阱 3：双窗口状态**

`MainWindow` 与 `NotePad` 各自持有 `content` state，不共享。快捷键必须绑定在**当前聚焦窗口的 document** 上（现在的 Ctrl+S 就是这么做的），不能做全局（Rust 层）快捷键——否则两个窗口会同时响应。

### 4.4 结论：Toolbar 能否抽取为统一 Markdown Command？

**能，而且成本很低。** 证据链：

1. `applyFormat` 已经是模块级纯函数，只依赖 `textarea` + `FormatAction` + `t` + 2 个回调（`MainWindow.tsx:136-142`）——没有闭包捕获组件状态。
2. `FormatAction` 是闭合字符串联合（`MainWindow.tsx:124-134`），可直接扩成 `MarkdownCommand`。
3. Toolbar 的调用点只有一处（`MainWindow.tsx:2952-2962`），替换成本 = 改一行 import。

需要做的改造（不是重构，是搬迁 + 扩展）：

- **搬迁**：`src/components/MainWindow.tsx` → `src/features/markdown/commands.ts`（`applyFormat` + `runEditorCommand` + `FormatAction`）
- **扩展**：`FormatAction` 增加 `link`、`setHeading1..6`（或用参数化 `{type:"heading", level:1..6}`）
- **新增**：`src/features/markdown/shortcuts.ts` —— `KeyboardEvent → MarkdownCommand | null` 的纯函数映射（可单测）
- **新增**：`useMarkdownShortcuts(textareaRef, run, {setContent, markDirty})` —— 统一绑定层，含 IME 守卫
- **修复**：`heading` 的"循环升一级"语义保留给 H 按钮；插入精确层级用新命令

**绝对不要做的**：为快捷键写第二份 `insertBold()` 之类的函数。那会立刻产生两套边界行为（例如 toolbar 有选区时用占位符、快捷键没有），这正是需求里明确禁止的。

---

## 5. Note Storage Data Flow

### 5.1 完整链路追踪

```
[User 输入]
  title (string)          MainWindow.tsx:2882-2894 / NotePad.tsx:855-872
  content (string)        MainWindow.tsx:2971 / NotePad.tsx:874
  category (string)       来自 notes.find(id).category（MainWindow.tsx:1157 / NotePad.tsx:340）
        │
        ▼  invoke("notes_update" | "notes_create")   src/features/notes/api.ts:34-40
[Command]
  update_note(id, SaveNoteRequest{title, content, category})    notes.rs:807
        │
        ▼
[Identity]
  create: id = Uuid::new_v4()                                   notes.rs:770
  update: id 由调用方传入，永不重新生成
        │
        ▼
[Filename]
  file_name = file_name_for(id, title)                          notes.rs:1322-1329
    = safe_title 为空 ? "{id}.md" : "{id}_{safe_title}.md"
  safe_title = safe_file_stem(title)                            notes.rs:1583-1608
    - 空白 与 < > : " / \ | ? * 及控制字符 → "_"（连续折叠）
    - 截断到 48 字符，两端去 "_"
        │
        ▼
[Path]
  note_path_in_category(file_name, category)                    notes.rs:1305-1312
    = data_dir/notes/<category?>/<file_name>
        │
        ▼
[Disk]
  fs::write(new_path, content)                                  notes.rs:827
  save_metadata(metadata_file)  → write_json_atomic             notes.rs:850, 1362-1365
  // 顺序：先写 .md，后写 metadata.json（.md 先落盘的窗口期 metadata 指向旧文件）
  if 路径变了 → recycle_path(old_path)  尽力而为，失败不报错       notes.rs:857-861
```

### 5.2 字段职责矩阵

| 字段                     | 定义处                                              | 权威来源                    | 是否随外部文件变化                                             |
| ------------------------ | --------------------------------------------------- | --------------------------- | -------------------------------------------------------------- |
| `id`                     | `Note.id` / `NoteMetadata.id`（`notes.rs:110,124`） | `metadata.json`             | 否（除非 rebuild）                                             |
| `title`                  | 同上                                                | `metadata.json`             | 否（rebuild 时从 `# 标题` 或文件名推断，`notes.rs:1633-1646`） |
| `file_name`              | 同上                                                | `metadata.json`（含扩展名） | 否                                                             |
| `category`               | 同上（`#[serde(default)]`）                         | `metadata.json`             | 否（rebuild 时取父目录名）                                     |
| `created_at`             | `notes.rs:115`                                      | `metadata.json`             | **rebuild 时退化为 mtime**                                     |
| `updated_at`             | `notes.rs:116`                                      | `metadata.json`             | 同上                                                           |
| `word_count` / `preview` | `notes.rs:117-118`                                  | 派生值，每次写时重算        | rebuild 时重算                                                 |
| `content`                | 只在 `Note`（`notes.rs:132`）                       | `.md` 文件                  | 是（但需重新读取）                                             |

**结论：`metadata.json` 是唯一权威元数据，`.md` 文件只承载正文。** 除了 `content`，所有字段在外部修改后都不会自动更新（因为没有任何文件监听器，只有 `refreshNotes()` 重新读 metadata.json）。

### 5.3 为什么当前文件名不可读

三个原因叠加，按影响排序：

1. **UUID 前缀占主导**（`notes.rs:1325`）：`0f3c1b8e-1a2b-4c3d-9e8f-....md`。在 Explorer 按名称排序时，排序键是 UUID 而不是标题。
2. **标题被安全化加工**（`safe_file_stem`，`notes.rs:1587-1605`）：`2025 阅读 A` → `2025_阅读_A`，空格变下划线；标题里的 emoji/标点可能被吞。
3. **分类只有一层**（`note_path_in_category`，`notes.rs:1305-1312`）：不能表达 `英语/阅读/`，所有子分类只能平铺在 `notes/` 下。

补充：文件名截断到 48 字符（`notes.rs:1602-1604`），长中文标题会被截。

### 5.4 UUID / Hash 是否承担 identity？

**UUID 承担双重角色，且不是唯一来源：**

| 角色              | 载体                         | 证据                                                                                        |
| ----------------- | ---------------------------- | ------------------------------------------------------------------------------------------- |
| 数据主键          | `metadata.json` 的 `id`      | `find_metadata` 按 `id` 查找（`notes.rs:1314-1320`）                                        |
| 附件命名空间      | `images/<id>/` 目录          | `images_dir()`（`notes.rs:883-885`），前端引用为 `images/<id>/<file>`（`notes.rs:911`）     |
| 窗口 label        | `tile-<id>` / `notepad-<id>` | `desktop.rs:1879-1885`；`tile-window-closed` 事件 payload 就是 id（`desktop.rs:1163-1166`） |
| 灾难恢复 identity | **文件名前缀**               | `id_from_file_name()`（`notes.rs:1624-1631`）                                               |

第 4 项是最危险的耦合：`rebuild_metadata()` 完全依赖"文件名第一个 `_` 之前是 UUID"这个约定。而 UUID 本身**不含 `_`**（v4 用 `-`），所以当前能工作。但标题安全化后仍可能含 `_`（`A_B_Test`），所以解析必须取**第一个** `_`——代码确实用了 `split_once('_')`，正确。

hash 没有出现（`sha2` 只用于更新包校验，`Cargo.toml:40`）。

### 5.5 Title 是否允许重复？

**允许，没有任何唯一性检查。** `create_note`（`notes.rs:768-805`）不检查同名。因为 `file_name` 含 UUID，同标题两篇笔记落在不同文件名，不冲突。

`update_note` 也不检查。这意味着如果 M2 去掉 UUID，**必须新增重名消解策略**（见 §8）。

### 5.6 Category 是否映射真实目录？

**是，但只有一层，且校验不完整。**

- 映射：`note_path_in_category` 直接 `notes_dir.join(category)`（`notes.rs:1305-1312`）
- 列举：`list_categories()` 只读 `notes/` 的**直接子目录**（`notes.rs:983-989`）
- 创建：`create_category` 拒绝空、`/`、`\`、`:`、`..`（`notes.rs:994-1006`）
- 重命名：`rename_category` 同样校验 + 检查目标已存在（`notes.rs:1008-1039`）
- 删除：`delete_category` 把该分类下笔记**移回根目录**（改 `category=""`），再把空目录移入回收站（`notes.rs:1041-1093`）

**审计发现（值得记录，不属本轮修复范围）**：`move_note_to_category`（`notes.rs:1095-1126`）**没有做名称校验**，直接把 `category` 拼进路径。若调用方传入 `../../x`，会产生越界路径。前端目前只传 `list_categories()` 的返回值，所以实际不可达，但这是一个"校验逻辑分布在 3 处、漏了 1 处"的架构信号——M2 引入多级目录时必须把校验收敛到一处。

### 5.7 自定义 Notes Directory 如何工作？

三条路径，都会被解析成同一个 `data_dir`：

1. **环境变量** `FLORAL_NOTEPAPER_DATA_DIR`（最高优先级，`notes.rs:242-247`、`262-267`）
2. **配置字段** `dataDir`（`notes.rs:276-284`），由 UI"选择文件夹"写入 →`config_migrate_data_dir` → `migrate_data_to`（`lib.rs:271-283`）
3. **旧字段** `notesDir`（v1.0.0–1.0.3 遗留，`notes.rs:315-323`），读到就转换成 `data_dir`，不再写回（`#[serde(skip_serializing)]`，`notes.rs:91-95`）

`migrate_data_to()`（`notes.rs:1444-1505`）是**三阶段**迁移，设计得比较稳：

1. 只复制不删除（失败可重试，源数据完好）
2. 切换配置（提交点）
3. 清理旧位置（失败只留冗余副本，日志记录）

并且拒绝：目标 == 当前、目标在当前目录内部（`notes.rs:1448-1458`）、根目录/系统目录（`is_safe_data_dir`，`notes.rs:634-671`）。

**M2 影响**：任何目录结构变更都必须同时兼容这三条入口，并且 `migrate_data_to` 的 `DATA_DIR_ITEMS`（`notes.rs:325`：`["metadata.json","notes","images","backgrounds"]`）是硬编码白名单——如果 M2 新增目录项（如 `templates/`），必须同步。

### 5.8 外部 .md 如何打开 / 导入？

**两条完全不同的路径，互不相通。这是 M2 的核心矛盾。**

**路径 1：外部文件标签页（不进入笔记库）**

```
文件关联 .md/.txt  (tauri.conf.json:56-69)
  → 双击 .md → 进程参数
  → single_instance 插件捕获 (lib.rs:443-448)
  → desktop::extract_file_arg(args) (desktop.rs:1113)
  → emit("open-external-file", path)
  → MainWindow.loadExternalFile(path) (MainWindow.tsx:667-708)
      id = filePath（绝对路径！）
      加入 externalFiles 内存数组（MainWindow.tsx:351）
      readExternalFile / saveExternalFile（lib.rs:67-73, 94-107）
```

特征：

- `externalFiles` 是**纯内存** state，重启即失（`MainWindow.tsx:351` 无持久化）
- 不进入 `metadata.json`，不出现在笔记列表，不参与搜索
- **不支持图片粘贴**：`useImagePaste` 被 `disabled: isExternal` 关掉（`MainWindow.tsx:1629`）
- 有 mtime 轮询（1s，`MainWindow.tsx:1043-1068`），外部改动会覆盖编辑器内容——**这是全项目唯一的外部变更感知机制**

**路径 2：导入（进入笔记库，但变成副本）**

```
handleImportNote (MainWindow.tsx:1386-1399)
  → dialog 选文件 (importExport/api.ts:13-23)
  → invoke("notes_import_markdown", {path, category}) (lib.rs:50-59)
  → import_markdown_file() (notes.rs:957-969)
      content = read_to_string(path)
      title = 首个 "# " 行，否则文件 stem，否则 "导入笔记" (notes.rs:1655-1673)
      → create_note() → 新 UUID + 新文件名 + 复制正文
```

**导入 = 复制，不是链接。原文件后续变动不会反映。** 这是 M2 用户"用 Typora 编辑同一篇笔记"诉求的直接障碍。

### 5.9 图片 / 附件如何引用？

```
粘贴 → useImagePaste.processFiles (useImagePaste.ts:80-118)
  → saveImage(noteId, bytes, ext) → invoke("images_save") 走 raw payload (lib.rs:147-172)
  → NoteStore::save_image() (notes.rs:887-912)
      dir = data_dir/images/<noteId>/
      file = <uuid>.<ext>
      返回 "images/<noteId>/<file>"
  → 正文插入 ![](images/<noteId>/<file>)   (useImagePaste.ts:99)
```

渲染时（`imageSrc.ts:5-20`）：仅当 `src` 以 `images/` 开头且已知 `imageBaseDir` 时，转成 `convertFileSrc(<dataDir>/images/...)`。

Tauri 侧需要 asset protocol 授权（`tauri.conf.json:30-33` + `lib.rs:449-455` 在 setup 里 `allow_directory(images)` 与 `allow_directory(backgrounds)`；迁移后再次授权 `lib.rs:276-279`）。

**关键不变式**：图片以 **note ID** 为命名空间，**与文件路径无关**。所以"笔记文件改名/移动"不会破坏图片引用——这是现有设计里对 M2 最有利的一点。反过来说，如果改成 filename=identity，图片目录也要跟着改，风险显著上升。

清理：`clean_unused_images()` 按 `content.contains("images/<id>/<file>")` 判活（`notes.rs:922-955`）——**字符串包含判断**，如果 M2 改了引用格式（例如改成 `./assets/`），这里会静默失效。

### 5.10 搜索 / index 是否依赖路径？

**不依赖，且没有 index。**

- 搜索：`filterNotes(notes, query)`（`noteUtils.ts:90-100`），在**前端内存**里对 `title / preview / fileName / displayTitle` 做 `includes`
- 数据来源：`notes_list()` 返回的 `Vec<NoteMetadata>`（全量）
- 没有 FTS、没有倒排、没有落盘索引

所以 M2 改文件名/目录结构**不会破坏搜索**。但要注意 `filterNotes` **搜索 `fileName`**（`noteUtils.ts:95`）——文件名变成人类可读之后，搜索命中率反而会上升（因为标题在文件名里），这是 M2 的隐性收益。

### 5.11 配置 / 数据库是否保存 path？

| 位置                                      | 存了什么路径              | 类型   | 风险                                              |
| ----------------------------------------- | ------------------------- | ------ | ------------------------------------------------- |
| `config.json` → `dataDir`                 | 数据根目录绝对路径        | 绝对   | 移动数据目录需 `migrate_data_to`                  |
| `config.json` → `backgroundImagePath`     | 背景图绝对路径            | 绝对   | 有 `remap_path_prefix` 迁移（`notes.rs:445-453`） |
| `metadata.json` → `fileName` + `category` | **相对**（不含 data_dir） | 相对   | 改根目录免迁移 ✅                                 |
| `ExternalFile.filePath`                   | 绝对                      | 内存态 | 不持久化，无风险                                  |
| 窗口 label `tile-<id>`                    | note id                   | —      | id 变则窗格失效                                   |

**没有数据库。** `Cargo.toml` 无 sqlite/rusqlite/sled 依赖。

`metadata.json` 存相对路径（`fileName` + `category` 分离）是一个**好设计**，M2 应当保留：它让"data_dir 迁移"不需要重写 metadata。

### 5.12 是否存在 migration / versioning？

**没有 schema version 字段。** `MetadataFile { notes: Vec<NoteMetadata> }`（`notes.rs:210-214`）没有 `version`，`AppConfig` 也没有。

现有迁移全是"探测式"（detect-and-fix），没有版本号驱动：

| 迁移               | 触发条件                                            | 位置                                                                                                          |
| ------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 旧 config 目录探测 | `config.json` 不存在                                | `notes.rs:1184-1238`，候选目录 `~/Documents/花笺`、`~/Library/Application Support/花笺`（`notes.rs:563-583`） |
| 松散笔记归位       | `notesDir` 无 `notes` 后缀（v1.0.0–1.0.3）          | `rescue_loose_legacy_notes`（`notes.rs:349-398`）                                                             |
| aux 数据搬迁       | `metadata.json`/`images`/`backgrounds` 仍在旧主目录 | `migrate_legacy_aux_data`（`notes.rs:329-345`）                                                               |
| 数据目录重定位     | 配置 `dataDir` ≠ 本次解析结果                       | `migrate_data_dir_if_relocated`（`notes.rs:1511-1548`）                                                       |
| metadata 损坏修复  | JSON 解析失败                                       | 备份为 `metadata.corrupt-<ts>.json` 后 rebuild（`notes.rs:1340-1359`）                                        |
| macOS 快捷键默认值 | v3 marker 文件                                      | `notes.rs:21, 697-700, 1250-1266`                                                                             |

**M2 必须引入 schema version。** 理由：M2 会改变文件名格式，而现有所有迁移都是"幂等探测"，无法区分"旧格式待迁移"与"用户故意起的新格式名字"。没有版本号，M2 迁移会与 `rebuild_metadata` 的推断逻辑互相打架。

### 5.13 一个必须记录的行为副作用：标题编辑会持续往回收站丢文件

`update_note` 在文件名变化时调用 `recycle_path(old_path)`（`notes.rs:857-861`），Windows 上走 `SHFileOperationW + FOF_ALLOWUNDO`（`notes.rs:488-539`），即**真的进回收站**。

而标题输入框每次 `onChange` 就 `markDirty`（`MainWindow.tsx:2885-2888`），900ms 防抖后触发保存。所以：

> 用户把标题从"英语"改成"英语阅读A"，每停顿一次就产生一次 `file_name` 变化 → 每停顿一次就有一个废弃 .md 进回收站。

这对 M2 是直接证据：**"标题即文件名"会让 rename 频率暴涨**，必须重新设计 rename 策略（见 §8.4），否则回收站会被垃圾塞满。

---

## 6. Current Filename / Identity Mechanism

### 6.1 现状总结

```
identity      = UUID v4（metadata.json 权威）
filename      = {uuid}_{safe_stem(title)}.md
path          = <data_dir>/notes/<category>/<filename>
authority     = metadata.json（唯一权威，无版本号）
recovery      = 文件名前缀反推 id + mtime 填时间 + 首个 "# " 填标题
```

### 6.2 现有不变式（M2 不得破坏）

| #   | 不变式                                    | 证据                                                                                                                       | 违反后果                          |
| --- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| I1  | 文件名必须 `.md` 结尾                     | `scan_dir_for_notes` 只收 `Some("md")`（`notes.rs:1414`）                                                                  | 笔记从重建结果消失                |
| I2  | 文件名首个 `_` 之前必须是 id              | `id_from_file_name`（`notes.rs:1624-1631`）                                                                                | rebuild 后 id 漂移，附件/磁贴失联 |
| I3  | `category` 必须是 `notes/` 下的一级目录名 | `note_path_in_category`（`notes.rs:1305-1312`）                                                                            | 路径错位，读写失败                |
| I4  | 图片引用格式固定 `images/<id>/<file>`     | `save_image`（`notes.rs:911`）、`resolveMarkdownImageSrc`（`imageSrc.ts:15`）、`clean_unused_images`（`notes.rs:941-942`） | 图片全裂 + 清理逻辑误删           |
| I5  | id 必须能安全进窗口 label                 | `sanitize_label_part`（`desktop.rs:1879-1889`）                                                                            | 磁贴/便签窗创建失败               |
| I6  | 同 id 在 metadata 中唯一                  | `find_metadata` 返回第一个匹配（`notes.rs:1314-1320`）                                                                     | 行为不确定                        |
| I7  | `.md` 先写、metadata 后写                 | `notes.rs:827` → `850`                                                                                                     | 中途崩溃则 metadata 指向旧内容    |
| I8  | rebuild 只在 metadata 不可用时触发        | `ensure_storage`（`notes.rs:1284-1299`）                                                                                   | 频繁 rebuild 会丢 `created_at`    |

### 6.3 为什么"把 UUID 改成标题"会立刻出问题（逐条击穿）

假设改成 `file_name = "{title}.md"` 且不改其它：

| 场景                                 | 后果                                                                                         | 依据                                                        |
| ------------------------------------ | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 两篇同名"随笔"                       | 第二次 `fs::write` **覆盖第一篇**                                                            | `notes.rs:790`/`827` 无存在性检查                           |
| 标题含 `:` `?` `*` `"` `<` `>` `\|`  | Windows 写入失败（若不做安全化）                                                             | `safe_file_stem` 存在正是为此（`notes.rs:1587-1590`）       |
| 标题为空                             | 文件名变成 `.md`（隐藏文件）                                                                 | `file_name_for` 的空标题分支依赖 id（`notes.rs:1324-1328`） |
| 标题纯中文                           | 文件名 OK，但 `id_from_file_name` 返回整个中文 stem 当 id → rebuild 后 id 与 metadata 不一致 | `notes.rs:1626-1630`                                        |
| 标题改一次                           | 文件 rename 一次 + 旧文件进回收站                                                            | `notes.rs:857-861`（见 §5.13）                              |
| 用户用 Explorer 移动笔记到别的文件夹 | metadata 的 `category` 失效 → `list_notes` 过滤掉该笔记（**笔记"消失"但文件还在**）          | `notes.rs:742-745`                                          |
| 用户用 Explorer 改名                 | 同上，且 rebuild 后 `created_at` 变 mtime                                                    | `notes.rs:1424-1436`                                        |
| 用 Typora 编辑                       | 编辑器内容不刷新（无 watcher），下一次自动保存**静默覆盖** Typora 的修改                     | 无 watcher；`notes.rs:827` 直接覆盖                         |

**A（filename = identity）不可接受的原因**：它把 8 条不变式中的 I2 从"文件名含 id"反转成"文件名就是 id"，于是每次 rename 都是一次主键变更，而 `images/<id>/`（I4）、窗口 label（I5）、pinned 磁贴全部以 id 为外键。

---

## 7. M1 Recommended Design

### 7.1 设计原则

1. **一个命令实现**：`MarkdownCommand` 是唯一入口，Toolbar 与 Shortcut 都是它的调用者。
2. **不改 undo 语义**：所有命令仍走 `execCommand("insertText")` 整篇替换路径。
3. **不改 toolbar 行为**：现有 10 个 action 的行为逐字节保持（含 `heading` 的循环升一级语义）。
4. **只增不改**：新增 `link`、`setHeading(level)`，其余不动。
5. **IME 优先**：组合态直接 return，不 preventDefault。

### 7.2 分层

```
src/features/markdown/
  commands.ts          ← 从 MainWindow.tsx:124-310 搬迁
      type MarkdownCommand =
        | { type: "bold" } | { type: "italic" } | { type: "hr" }
        | { type: "ul" } | { type: "ol" } | { type: "code" } | { type: "quote" }
        | { type: "inlineMath" } | { type: "blockMath" }
        | { type: "headingCycle" }              ← 原 heading，给 H 按钮
        | { type: "setHeading"; level: 1|2|3|4|5|6 }   ← 新，给 Ctrl+1..6
        | { type: "link" }                      ← 新，给 Ctrl+K
      export function applyCommand(textarea, command, ctx: { t, setContent, markDirty })
      export function runEditorCommand(textarea, "undo"|"redo")

  shortcuts.ts         ← 纯函数，可 100% 单测
      export function commandForEvent(e: KeyboardEvent, isMac: boolean): MarkdownCommand | null
      // 规则表：Ctrl+B/I/K、Ctrl+1..6、Ctrl+Shift+7/8（ol/ul）、Ctrl+Shift+9（quote）

  useMarkdownShortcuts.ts  ← 绑定层
      export function useMarkdownShortcuts(textareaRef, ctx, deps): void
      // document keydown 监听，含：isComposing 守卫 / 仅 textarea 聚焦时生效 / preventDefault
```

### 7.3 快捷键映射建议（贴近 Typora / Obsidian）

| 快捷键                          | 命令                                        | 备注                                                    |
| ------------------------------- | ------------------------------------------- | ------------------------------------------------------- |
| `Ctrl+B`                        | `{type:"bold"}`                             | 与 Typora 一致                                          |
| `Ctrl+I`                        | `{type:"italic"}`                           | 一致                                                    |
| `Ctrl+K`                        | `{type:"link"}`                             | 一致（Obsidian 也是 Ctrl+K）                            |
| `Ctrl+1..6`                     | `{type:"setHeading", level:n}`              | Typora 行为；**再按同一级应降为正文**（见 §7.5 决策点） |
| `Ctrl+0`                        | `{type:"setHeading", level:0}` 或"清除标题" | 可选，Typora 有                                         |
| `Ctrl+Shift+]` / `Ctrl+Shift+[` | `ol` / `ul`                                 | Obsidian 风格；也可用 `Ctrl+Shift+7/8`                  |
| `Ctrl+Shift+9`                  | `quote`                                     | 可选                                                    |
| `Ctrl+Shift+K`                  | `code`                                      | 可选                                                    |

**不要动**：`Ctrl+Z` / `Ctrl+Y` / `Ctrl+S` / `Ctrl+A` / `Ctrl+C` / `Ctrl+V` / `Tab`。

### 7.4 `link` 命令形态

```
有选区：  [选中文字](|)        光标停在 url 位置
无选区：  [](|)                光标停在 url 位置（方括号内留空）
```

不做联网/文件选择弹窗（保持零依赖），只插入骨架——与 Typora 的 `Ctrl+K` 一致（Typora 也是先插骨架）。

### 7.5 需要用户决策的 3 个点（列入 §14 Open Questions）

1. `Ctrl+1` 在已是 H1 时：无操作（Typora）还是切回正文（Obsidian 部分配置）？
2. 列表快捷键用 `Ctrl+Shift+8`（Typora）还是 `Ctrl+Shift+]`（Obsidian）？两者都注册会不会太挤？
3. 便签小窗（`NotePad`）是否也要生效？建议**要**（同一 hook 复用），但便签窗没有 toolbar，用户可能不知道支持。

### 7.6 验证要点（M1）

- 选中 3 行 → Ctrl+B → 一次 Ctrl+Z 完全回到原状（undo 单条目）
- 中文输入法组合中按 Ctrl+B → 不打断 composition、不插入 `**`
- Ctrl+1 后光标位置仍在原字符旁（不是跳到文首）
- 长文档（>5000 行）用快捷键后 `scrollTop` 不跳回顶部（现有 rAF 恢复逻辑需保留）
- 主窗口与便签窗同时打开 → 快捷键只影响聚焦窗口

---

## 8. M2 Recommended Design

### 8.1 结论先行

**选择 B：stable internal ID + human-readable filename/path。** 并且 ID 不进入文件名（或仅作为可选后缀），而是收敛到**单一权威源**。

明确否决 A（filename = identity）：§6.3 已列出 8 条不变式被击穿的具体后果，核心是 `images/<id>/`、`tile-<id>` 窗口 label、pinned 磁贴状态全部以 id 为外键，而 `rebuild_metadata` 目前又反向依赖文件名——两边都改会造成身份系统双写。

### 8.2 目标形态与映射

```
<data_dir>/notes/                          ← 笔记根（保持不变）
  英语/
    阅读/
      2025阅读A.md                          ← filename = sanitized(title) + 消解后缀
      2025阅读B.md
    完型/
      2025完型.md
  CG/
    Shader学习.md
  未分类笔记.md                             ← 无序分类（category="")
```

对应字段变化：

| 概念        | 现在                          | 目标                                                          |
| ----------- | ----------------------------- | ------------------------------------------------------------- |
| `category`  | 单层字符串 `"英语"`           | **多级相对路径** `"英语/阅读"`（仍存 metadata，不存绝对路径） |
| `file_name` | `{uuid}_{title}.md`           | `{title}.md`（重名 → `{title} (2).md`）                       |
| `id`        | UUID，同时是文件名前缀        | UUID，**只在 metadata.json**（+ 可选 frontmatter）            |
| 权威源      | metadata + 文件名推断（双源） | **metadata 单一权威**；文件名推断降级为"首次导入时的兜底"     |
| 版本        | 无                            | `metadata.json` 增加 `"schemaVersion": 2`                     |

### 8.3 三个子方案对比

| 方案   | 文件名                 | id 存哪                                          | 外部改名后 id                                               | 复杂度 | 推荐               |
| ------ | ---------------------- | ------------------------------------------------ | ----------------------------------------------------------- | ------ | ------------------ |
| **B1** | `{title}.md`           | 仅 metadata.json                                 | **丢失**（下次 rebuild 生成新 id，丢 created_at，磁贴失联） | 低     | 可作 M2 第一步     |
| **B2** | `{title}.md`           | metadata.json + **YAML frontmatter `floral-id`** | **保留**（id 随文件走，支持 Explorer 移动/改名/跨库拷贝）   | 中     | ✅ **目标方案**    |
| **B3** | `{title}__{short8}.md` | 文件名后缀                                       | 保留（但用户改名就丢）                                      | 低     | 备选（不污染正文） |

**推荐 B2**，理由：

1. frontmatter 是 Markdown 生态标准（Obsidian / Jekyll / Hugo 都用），Typora 会原样保留未知字段，不会破坏。
2. id 随文件移动，`英语/阅读/2025阅读A.md` 被 Explorer 拖到 `CG/` 后，只需重算 `category`，id 不变 → 磁贴、附件、收藏全部存活。
3. 支持"从旧库拷一篇 .md 进新库"这类操作而不产生重复。

代价与对策：

- 正文会多 3 行 frontmatter → **必须由 Rust 层剥离**：读时去掉，写时加回。用户在编辑器里**永远看不到** frontmatter（`read_note` 返回的 `content` 不含它）。导出的 `.md`（`export_markdown_file`）按用户偏好决定是否包含（建议包含，便于外部工具识别）。
- 用户手改 frontmatter 可能写坏 id → 读取时校验 UUID 格式 + 全局唯一，非法则视为缺失并重新分配（同时记日志）。

如果认为 frontmatter 侵入性太强，**退一步选 B3**：文件名 `2025阅读A__a1b2c3d4.md`，id 后缀视觉可接受，Typora 侧完全透明。

### 8.4 四个必须设计的子系统

**(1) 文件名消解（同名笔记）**

```
target = sanitize(title)
if not exists:            use target.md
else if same note id:     use target.md（就地覆盖，正常保存）
else:                     target (2).md, target (3).md, …
```

必须在 Rust 侧做（唯一能原子判断存在性的地方），且**在 metadata 事务内**完成。前端不参与命名决策。

**(2) Windows 非法字符与保留名**

在现有 `safe_file_stem`（`notes.rs:1583-1608`）基础上补：

| 类别                                   | 现状                                                  | 需补                                                                                               |
| -------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `< > : " / \ \| ? *`                   | 已替换 `_`                                            | —                                                                                                  |
| 控制字符                               | 已替换（`ch.is_control()`）                           | —                                                                                                  |
| 尾随 `.` / 空格                        | ❌ 未处理（Windows 会静默去除，导致文件名与预期不符） | 必须 trim                                                                                          |
| 保留名 `CON PRN AUX NUL COM1-9 LPT1-9` | ❌ 未处理                                             | 必须加前缀/后缀                                                                                    |
| 长度                                   | 48 字符                                               | 需考虑 **完整路径 ≤ 260**（`\\?\` 未启用）；多级目录会吃掉预算，建议文件名 ≤ 64 且对超长做哈希后缀 |
| 大小写不敏感                           | 未处理                                                | `README.md` 与 `readme.md` 同文件，需按 case-insensitive 检测重名                                  |

**(3) Rename 策略（解决 §5.13 的回收站污染）**

现状：每次保存都重算文件名 + 回收站旧文件。目标：

- **正文保存不触发 rename**：只有 `title` **语义变化**（不是每次 onChange）且**用户确认/失焦**时才 rename
- **rename 用 `fs::rename` 而不是 `recycle_path`**：rename 是同卷原子操作，不需要回收站
- 提供显式"重命名"入口（右键菜单，当前 `noteContextMenu.ts` 只有 export/move/delete，`src/features/notes/noteContextMenu.ts:9-26`）
- 若 M2 保留"标题即文件名"，则必须设置 **rename 节流**（例如 3s 且标题已稳定），并禁止 recycle

**(4) 外部修改对账（M2 的真正难点）**

现状：**没有 watcher**。仅外部文件标签页有 1s mtime 轮询（`MainWindow.tsx:1043-1068`）。笔记库完全无感知。

后果：用户在 Typora 改了 `2025阅读A.md` → 应用内编辑器仍是旧内容 → 自动保存（900ms）**静默覆盖**用户刚写的字。这是"Filesystem-friendly"承诺下最严重的用户数据丢失路径。

建议分层：

| 层         | 机制                                                                                                             | 触发                | 成本                            |
| ---------- | ---------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------- |
| L1（必须） | 保存前 `mtime` 比对：若磁盘 mtime > 上次已知 mtime，则**不写**，提示"磁盘内容已变化，请选择：保留磁盘/覆盖/另存" | 每次 `notes_update` | 低，纯 Rust                     |
| L2（推荐） | 打开笔记时重读 + 若 mtime 变化则刷新编辑器（仅在无未保存修改时）                                                 | `notes_get`         | 低                              |
| L3（可选） | `notify` crate 监听 `notes/` 目录，500ms 去抖后重建元数据 + 广播 `notes-changed`                                 | 常驻                | 中（引入依赖 + 窗口风暴需节流） |

**L1 是 M2 的准入条件**，否则"用外部编辑器"这个核心诉求会变成数据丢失的入口。

### 8.5 兼容性策略（与上游共存）

| 项                           | 策略                                                                                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 旧文件名 `{uuid}_{title}.md` | M2 迁移时保留 **read path 双兼容**：`id_from_file_name` 继续支持；新文件用新格式                                                                                    |
| `metadata.json`              | 增加 `schemaVersion`，旧文件无此字段 → 视为 v1，触发一次性迁移                                                                                                      |
| 迁移时机                     | 首次启动时 `schemaVersion < 2` → 备份 `metadata.json` → 逐条 rename → 写 v2                                                                                         |
| 迁移原子性                   | 单条失败不中断（与 `move_loose_note_file` 吞错语义一致，`notes.rs:413-427`），失败项保留旧格式并在 UI 汇总提示                                                      |
| 回滚                         | rename 前生成 `metadata.v1-backup-<ts>.json`；文件名可逆（uuid 前缀可重新加回）                                                                                     |
| 上游合并冲突                 | 冲突集中在 `notes.rs`（`file_name_for` / `scan_dir_for_notes` / `id_from_file_name` / `update_note`），建议把这 4 处抽成 `filename_policy.rs`，让上游 diff 保持可读 |

### 8.6 多级分类的最小实现

只改 3 处 + 加校验：

1. `note_path_in_category`：`category` 按 `/` 切分后逐级 join，并**拒绝** `..`、绝对路径、空段（`notes.rs:1305-1312`）
2. `rebuild_metadata`：改为递归扫描，`category` 存相对路径（`notes.rs:1386-1443`）
3. `list_categories`：改为递归列举目录树，返回相对路径列表（`notes.rs:980-992`）

**新增统一校验函数** `validate_category_path()`，替换 `create_category`（`notes.rs:999-1001`）、`rename_category`（`1013-1019`）、并**补上** `move_note_to_category`（`1095`，当前缺失）。

---

## 9. Migration Risks

| #   | 风险                      | 触发条件                                            | 影响                                                      | 缓解                                                      |
| --- | ------------------------- | --------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------- |
| R1  | **ID 漂移**               | 去掉文件名 UUID 且未实现 frontmatter/对账 → rebuild | 磁贴失联、`created_at` 丢失、附件孤儿                     | 用 B2；迁移前备份 metadata                                |
| R2  | **同名覆盖**              | 两篇同标题 + 无消解策略                             | **静默丢正文**                                            | `(n)` 后缀消解，Rust 侧原子判断                           |
| R3  | **非法文件名写入失败**    | 标题含 `?:*` 或保留名 `CON`                         | 保存报错（可见），或文件被 Windows 静默改名（更糟）       | 完整 sanitize（§8.4-2）                                   |
| R4  | **外部改名后笔记"消失"**  | Explorer 改名/移动                                  | `list_notes` 过滤掉（`notes.rs:742-745`），用户以为丢数据 | L1/L2 对账 + "发现未跟踪 .md"提示                         |
| R5  | **外部编辑被覆盖**        | Typora 改完 + 应用自动保存                          | **数据丢失**                                              | §8.4(4) L1 强制                                           |
| R6  | **Rename 污染回收站**     | 每次标题编辑                                        | 回收站堆积大量 .md                                        | §8.4(3)：rename 用 `fs::rename`                           |
| R7  | **图片全部失效**          | 改 `images/` 引用格式或笔记 id                      | 正文图片裂                                                | 保持 `images/<id>/` 不变式（I4）；M2 不动附件布局         |
| R8  | **搜索退化**              | 无（现为内存过滤）                                  | 无                                                        | 无需处理，但要保留 `fileName` 进 search 字段              |
| R9  | **迁移中断**              | 大量 rename 时崩溃/断电                             | 一半新一半旧                                              | 逐条幂等 + 可重入；`write_json_atomic` 保证 metadata 原子 |
| R10 | **上游合并冲突**          | M2 改动集中在 `notes.rs`                            | 后续 pull 上游困难                                        | 抽出 `filename_policy.rs`，减少 diff 面积                 |
| R11 | **数据目录迁移白名单**    | M2 新增目录项                                       | `migrate_data_to` 漏搬                                    | 同步 `DATA_DIR_ITEMS`（`notes.rs:325`）                   |
| R12 | **asset protocol 未授权** | 图片/附件换目录                                     | 预览空白（无报错）                                        | 同步 `lib.rs:452-454` + `276-279` 的 `allow_directory`    |
| R13 | **前端缓存旧 metadata**   | 外部变更后无 `notes-changed`                        | UI 显示旧标题/旧预览                                      | 变更后主动 emit                                           |

---

## 10. Windows Build / Distribution

### 10.1 Dev build

```
npm run dev                      → vite dev server :1420（package.json:7）
npm run tauri dev                → beforeDevCommand 自动起 vite（tauri.conf.json:7-8）
```

需要：Node ≥ 22、Rust stable、MSVC Build Tools、WebView2。

### 10.2 Release build

**标准命令**（Tauri 2）：

```
npm run tauri -- build --target x86_64-pc-windows-msvc --bundles nsis
```

`beforeBuildCommand` 会先 `taskkill` 掉已运行的实例，再 `npm run build`（`tsc && vite build`）（`tauri.conf.json:9`、`package.json:8`）。

**本地脚本**（推荐，仓库自带）：

```
pwsh -File scripts/build-windows-local.ps1 -Architectures x64 -OutputDir local-build/windows
```

产物（`scripts/build-windows-local.ps1:217-258`）：

| 产物        | 路径                                                     | 说明                                    |
| ----------- | -------------------------------------------------------- | --------------------------------------- |
| 便携 EXE    | `src-tauri/target/<target>/release/floral-notepaper.exe` | **自包含**，可直接分发                  |
| NSIS 安装包 | `.../release/bundle/nsis/*.exe`                          | 安装到 Program Files，写注册表/文件关联 |
| MSIX        | `local-build/windows/*.msix`                             | **需要证书 + Store 身份**，个人分发不用 |
| MSIXUPLOAD  | `*.msixupload`                                           | 仅用于 Partner Center 提交              |

**个人定制分发应只取前两个，跳过 MSIX**（`scripts/build-windows-local.ps1:242-258` 的 MSIX 段可整段不跑，直接用 `tauri build`）。

### 10.3 Runtime dependency：WebView2

- `Cargo.toml:47` 引入 `webview2-com`，Tauri 2 在 Windows 上依赖系统 WebView2 Runtime
- 本机已安装：`C:\Program Files (x86)\Microsoft\EdgeWebView\Application\145.0.3800.97`
- `tauri.conf.json` **未配置 `bundle.windows.webviewInstallMode`** → 使用 Tauri 默认（`downloadBootstrapper`），NSIS 安装时会检测缺失并联网下载
- 便携 EXE **不做任何安装**：如果目标机器没有 WebView2（Win10 早期 / LTSC），会直接启动失败

**分发建议**：

| 目标机器                | 建议                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Win11（自带 WebView2）  | 便携 EXE 直接可用                                                                                                   |
| Win10 21H2+（多数已有） | 便携 EXE 基本可用                                                                                                   |
| Win10 LTSC / 纯净系统   | 改 `webviewInstallMode` 为 `embedBootstrapper` 或 `offlineInstaller`（体积 +~1.8MB / +~127MB），或先手动装 WebView2 |

### 10.4 当前环境状态（实测）

| 依赖                  | 状态               | 证据                                             |
| --------------------- | ------------------ | ------------------------------------------------ |
| Node                  | ✅ `v22.22.2`      | `node -v`                                        |
| npm                   | ✅ `10.9.7`        | `npm -v`                                         |
| `node_modules`        | ❌ **缺失**        | 目录不存在，需 `npm ci`                          |
| Rust / cargo / rustup | ❌ **未安装**      | `cargo --version` → not found；`~/.cargo` 不存在 |
| WebView2 Runtime      | ✅ `145.0.3800.97` | 已安装目录                                       |
| `src-tauri/target`    | ❌ 无构建缓存      | 目录不存在                                       |

**结论**：S1（能否产出不要求用户装 Node/Rust 的 EXE）**架构上成立**——Tauri 把前端资源编译进 Rust 二进制，终端用户零开发依赖。但**本机当前无法构建**，需要先：

1. `npm ci`
2. 安装 Rust（`rustup-init.exe`，选 `x86_64-pc-windows-msvc`）
3. 安装 VS Build Tools 的 "Desktop development with C++"（提供 MSVC linker + Windows SDK）
4. 首次 `cargo build` 会下载 ~400 crates（`Cargo.lock` 在仓库里，可离线复现）

### 10.5 分发的 3 个额外必修项

**(1) 内置更新器必须改指向（P0）**

`DEFAULT_GITHUB_REPO = "Achilng/floral-notepaper"`（`src-tauri/src/updater/check.rs:26`），调度器在启动时自动检查（`lib.rs:463-465`）。个人定制版若不处理：

> 上游发新版本 → 应用提示更新 → 下载上游二进制 → 覆盖本地 → **M1/M2 全部消失**。

三个处理选项（按侵入性排序）：

- 环境变量 `FLORAL_NOTEPAPER_UPDATE_GITHUB_REPO`（已有，`check.rs:25`）指向自己的 fork
- 改 `DEFAULT_GITHUB_REPO` 为自己的仓库
- 个人版直接不调用 `start_auto_check_scheduler`（`lib.rs:464`）并隐藏更新 UI

**(2) 版本号与产品标识**

`productName: "花笺"`（`tauri.conf.json:3`）、`identifier: "com.floral-notepaper.app"`（`:5`）。如果与上游共存安装，**identifier 相同会互相覆盖**。个人版建议改 `identifier`（如 `com.lantian.floral-notepaper`）并考虑产品名加后缀，否则卸载/升级会打架。

**(3) 签名与 SmartScreen**

未签名 EXE 首次运行会触发 SmartScreen"未知发布者"。个人使用可忽略（点"仍要运行"），若要分发给他人需 Authenticode 证书（仓库有 `scripts/verify-authenticode.ps1` 与 SignPath 流程，但那是上游 CI 用的）。

### 10.6 dev / release 构建配置差异

| 配置           | Linux                                                 | macOS                          | Windows         |
| -------------- | ----------------------------------------------------- | ------------------------------ | --------------- |
| 主配置         | `tauri.conf.json`                                     | 覆盖为 `tauri.macos.conf.json` | 用主配置        |
| bundle targets | app/dmg/nsis/deb/rpm/appimage（`tauri.conf.json:38`） | macOS 专项                     | 实际只用 `nsis` |
| 最小系统       | —                                                     | macOS 15.0（`:45`）            | —               |

---

## 11. Files Likely To Change

### M1（预计 6 个文件，无 Rust）

| 文件                                               | 改动                                                                                                                 | 规模                    |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `src/features/markdown/commands.ts`                | **新增**：搬 `FormatAction` + `applyFormat` + `runEditorCommand`，扩 `link` / `setHeading`                           | ~200 行（大部分是搬迁） |
| `src/features/markdown/shortcuts.ts`               | **新增**：`commandForEvent()` 纯映射                                                                                 | ~60 行                  |
| `src/features/markdown/useMarkdownShortcuts.ts`    | **新增**：绑定 + IME 守卫                                                                                            | ~50 行                  |
| `src/components/MainWindow.tsx`                    | 删除本地 `applyFormat`/`runEditorCommand`/`FormatAction`，改 import，挂 hook                                         | -180 / +15 行           |
| `src/components/NotePad.tsx`                       | 挂同一个 hook（+ 可选：便签窗撤销入口）                                                                              | +5 行                   |
| `src/locales/{zh-CN,en-US,zh-HK}/translation.json` | 新增 `main.toolbar.link`、`main.editor.shortcutHint.*` 等键（**三语必须同步**，否则 `resources.test.ts:24-31` 失败） | 每个 +3~5 键            |
| `src/features/markdown/*.test.ts`                  | **新增**：`shortcuts.test.ts`（映射表）、`commands.test.ts`（区间/光标）                                             | ~150 行                 |

### M2（预计 4~6 个 Rust + 3~4 个前端）

| 文件                                                | 改动                                                                                                                                                                                 | 风险                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| `src-tauri/src/services/notes.rs`                   | `file_name_for`、`safe_file_stem`、`id_from_file_name`、`note_path_in_category`、`rebuild_metadata`、`list_categories`、`update_note`（rename 策略）、新增 `migrate_schema_v1_to_v2` | **高**（全部不变式集中于此）            |
| `src-tauri/src/services/filename_policy.rs`         | **新增**：sanitize + 重名消解 + 保留名 + 长度，纯函数可单测                                                                                                                          | 中                                      |
| `src-tauri/src/services/notes.rs`（`MetadataFile`） | 增加 `schema_version` 字段                                                                                                                                                           | 中（需 `#[serde(default)]` 兼容旧文件） |
| `src-tauri/src/lib.rs`                              | 新命令（如 `notes_reveal_in_explorer`）、`migrate_data_to` 白名单同步                                                                                                                | 低                                      |
| `src-tauri/src/desktop.rs`                          | （可选）`notify` watcher 生命周期挂到 `setup`                                                                                                                                        | 中                                      |
| `src/features/notes/types.ts`                       | `NoteMetadata` 增加 `schemaVersion`? / `category` 语义注释                                                                                                                           | 低                                      |
| `src/components/MainWindow.tsx`                     | 分类树 UI 支持多级（当前是平铺分组 `groupNotesByCategory`，`noteUtils.ts:48-88`）                                                                                                    | **中高**（UI 改动，3277 行文件）        |
| `src/features/notes/noteUtils.ts`                   | `groupNotesByCategory` 支持层级                                                                                                                                                      | 中                                      |
| `src/features/notes/noteContextMenu.ts`             | 增加"重命名"                                                                                                                                                                         | 低                                      |
| `src-tauri/capabilities/default.json`               | 若新增"在资源管理器中显示"，需 `opener:allow-open-path` 或自定义命令                                                                                                                 | 低                                      |

### 分发（预计 2~3 个文件）

| 文件                                | 改动                                                             |
| ----------------------------------- | ---------------------------------------------------------------- |
| `src-tauri/src/updater/check.rs:26` | `DEFAULT_GITHUB_REPO` 改为个人仓库（或改为可配置）               |
| `src-tauri/tauri.conf.json`         | `identifier`、`productName`、`bundle.windows.webviewInstallMode` |
| `scripts/build-windows-local.ps1`   | 跳过 MSIX 段（个人版不需要 Store 身份）                          |

**不改**：`src/features/markdown/MarkdownPreview.tsx`（渲染链与需求无关）、`src/features/update/*`（除 repo 常量）、`src-tauri/src/updater/*` 其余部分。

---

## 12. Recommended Milestones

| 阶段     | 内容                                                                               | 交付判定                                                                    | 依赖                              |
| -------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------- |
| **M0**   | 本次审计                                                                           | 本文档                                                                      | —                                 |
| **M0.5** | **构建环境就绪**：`npm ci` + 装 Rust + MSVC + 成功产出一次未签名 EXE               | `npm run tauri -- build --bundles nsis` 成功，`floral-notepaper.exe` 可启动 | 无代码改动                        |
| **M1a**  | 提取 `commands.ts`（纯搬迁，行为零变化）                                           | 现有 toolbar 10 个按钮行为逐项回归通过；`commands.test.ts` 覆盖             | M0.5                              |
| **M1b**  | 新增 `link` / `setHeading` 命令 + `shortcuts.ts` 映射 + hook 接入主窗              | Ctrl+B/I/K/1-6 生效；undo 单条目；IME 组合态不打断                          | M1a                               |
| **M1c**  | 接入便签窗 + locale 三语 + toolbar tooltip 显示快捷键                              | 两窗口一致；三语键位齐全                                                    | M1b                               |
| **M2a**  | **多级分类**（`category` 支持 `a/b`）+ 递归 rebuild + 分类树 UI                    | `英语/阅读/x.md` 可创建、可见、可读写；旧单层分类无损                       | M1 完成（避免同时改编辑器与存储） |
| **M2b**  | **文件名可读化**（去掉 uuid 前缀）+ 重名消解 + 完整 sanitize + rename 不再进回收站 | 磁盘文件名为标题；同名自动 `(2)`；标题编辑不产生回收站垃圾                  | M2a                               |
| **M2c**  | **identity 收敛**：`schemaVersion` + 一次性迁移 + （建议）frontmatter id           | 迁移后 id 不变；磁贴/附件全部存活；旧库可回滚                               | M2b                               |
| **M2d**  | **外部修改对账**：保存前 mtime 比对（L1）+ 打开时刷新（L2）                        | Typora 改动后应用内保存不静默覆盖                                           | M2c                               |
| **M3**   | 分发收尾：更新器指向、identifier/productName、WebView2 模式、便携 EXE + NSIS       | 干净 Win11 机器可直接运行；不误升级到上游                                   | M1/M2 稳定                        |

**顺序理由**：

- M0.5 必须最先——没有构建验证，任何 M1/M2 改动都是盲改。
- M1 先于 M2：M1 是纯前端、低风险、可独立验收；M2 触及存储核，应尽量在编辑器稳定后再动。
- M2a 先于 M2b：先有目录层级，再谈文件名；否则 `2025阅读A.md` 仍只能平铺。
- M2c 在 M2b 之后：先让文件名可读（可见收益），再把 identity 迁到 frontmatter/metadata（不可见但保命）。
- M2d 必须在 M2 承诺"外部工具可用"之前落地，否则是数据丢失入口。

---

## 13. Verification Matrix

| #   | 验证项                  | 方法                                                 | 适用   | 通过标准                                           |
| --- | ----------------------- | ---------------------------------------------------- | ------ | -------------------------------------------------- |
| V1  | 现有测试全绿            | `npm test`（vitest）                                 | 全阶段 | 0 失败                                             |
| V2  | Rust 单测全绿           | `cargo test --manifest-path src-tauri/Cargo.toml`    | 全阶段 | 0 失败（`notes.rs` 内 20+ 测试）                   |
| V3  | 类型检查                | `npm run build`（含 `tsc`）                          | 全阶段 | 无 TS 错误                                         |
| V4  | Lint / 格式             | `npm run lint`、`npm run fmt`                        | 全阶段 | 无新增告警                                         |
| V5  | 构建产出 EXE            | `npm run tauri -- build --bundles nsis`              | M0.5+  | 生成 exe 且能启动                                  |
| V6  | Toolbar 行为零变化      | 手动：10 个按钮 × {无选区, 单行选区, 多行选区}       | M1a    | 与改动前逐字一致（可用旧版截图对比）               |
| V7  | Undo 单条目             | 选中文字 → Ctrl+B → Ctrl+Z 一次                      | M1b    | 完全回到格式化前状态                               |
| V8  | Cursor / Selection 正确 | Ctrl+B 后光标停在被包裹文字后；Ctrl+1 后光标不跳文首 | M1b    | 视觉确认 + `commands.test.ts` 断言 cursorStart/End |
| V9  | Scroll 不跳             | 5000 行长文，滚动到中部，按 Ctrl+B                   | M1b    | `scrollTop` 不变                                   |
| V10 | 中文 IME 不打断         | 拼音组合中按 Ctrl+B                                  | M1b    | 候选框不消失、不插入 `**`                          |
| V11 | 快捷键只影响聚焦窗口    | 主窗 + 便签窗同时开，各按 Ctrl+B                     | M1c    | 只有聚焦窗口变化                                   |
| V12 | 不破坏现有快捷键        | Ctrl+S / Ctrl+Z / Tab 缩进 / Esc                     | M1c    | 行为不变                                           |
| V13 | 三语键位齐全            | `npm test`（`resources.test.ts` 强制键集一致）       | M1c    | 通过                                               |
| V14 | 多级分类可见            | 建 `英语/阅读`，建笔记，重启                         | M2a    | 笔记在树中，文件在 `notes/英语/阅读/`              |
| V15 | 旧单层分类无损          | 用 v1 数据目录启动                                   | M2a    | 所有旧笔记仍可见、可编辑                           |
| V16 | 同名笔记不覆盖          | 建两篇"随笔"                                         | M2b    | 磁盘上 `随笔.md` + `随笔 (2).md`，正文各自正确     |
| V17 | 非法字符                | 标题 `a:b*c?"d"`、`CON`、`尾部空格 `                 | M2b    | 全部保存成功且文件名合法                           |
| V18 | Rename 不进回收站       | 改 5 次标题                                          | M2b    | 回收站无新增 .md                                   |
| V19 | 迁移后 id 稳定          | 迁移前后对比 `metadata.json` 的 id 集合              | M2c    | id 集合完全相同                                    |
| V20 | 附件存活                | 迁移后打开含图笔记                                   | M2c    | 图片正常显示（`images/<id>/` 不变式）              |
| V21 | 磁贴存活                | 迁移前 pinned 一个磁贴，迁移后重启                   | M2c    | 磁贴仍指向同一笔记                                 |
| V22 | 外部编辑不丢失          | Typora 改文件 → 应用内触发保存                       | M2d    | 弹出冲突提示，不静默覆盖                           |
| V23 | 外部改名可发现          | Explorer 重命名 .md                                  | M2d    | 提示"发现未跟踪文件"或自动对账                     |
| V24 | 干净机可运行            | 在无 Node/Rust 的 Win11 上跑 EXE                     | M3     | 正常启动、可读写笔记                               |
| V25 | 不误升级                | 检查更新（指向个人仓库或已禁用）                     | M3     | 不会下载上游二进制                                 |
| V26 | 上游兼容                | `git diff main -- src-tauri/src/services/notes.rs`   | 每阶段 | diff 有界、可解释、无大规模重排                    |

---

## 14. Open Questions

以下问题需要你确认后，M1/M2 才能定稿实施细节：

**关于 M1**

1. `Ctrl+1` 在标题已是 H1 时：**无操作**（Typora）还是**切回正文**（Obsidian 可配）？
2. 列表快捷键用哪套：`Ctrl+Shift+8/7`（Typora）还是 `Ctrl+Shift+]/[`（Obsidian）？是否需要 `Ctrl+0` 清标题？
3. `link` 命令只插骨架 `[]()`，还是需要弹窗选择"本地文件 / URL"？（建议只插骨架，零依赖）
4. 便签小窗（`NotePad`）是否要支持这些快捷键？（建议要）
5. 是否需要在 toolbar 按钮 tooltip 里显示快捷键（如"粗体 (Ctrl+B)"）？需要则要改 3 个 locale。

**关于 M2** 6. 目标形态里 `Notes/` 是**数据目录的 `notes/` 子目录**（现有约定），还是你希望把整个 `Documents/花笺` 或自定义目录直接作为笔记根（即去掉 `notes/` 这一层）？后者需要更大的迁移。7. 是否接受 **YAML frontmatter 存 id**（B2，正文会多 3 行，但在编辑器里隐藏）？还是倾向 **id 后缀文件名**（B3，正文纯净但文件名略脏）？8. 同名笔记消解后缀用 ` (2)`（Windows 风格）还是 `-2`（更干净）？9. 是否需要**显式"重命名笔记"入口**（右键菜单），还是继续"改标题即改名"？10. 外部修改冲突（V22）默认策略：**保留磁盘内容**（保守，可能丢应用内未保存的编辑）还是**保留应用内容**（可能丢外部编辑）？建议默认前者 + 弹窗选择。11. 是否需要 L3（真实文件监听 `notify`）？它会让"Explorer 里新建 .md 立刻出现在列表"，但引入常驻 watcher 与窗口事件风暴。12. 分类层级上限：**2 级**（符合目标形态）还是**任意层级**？影响校验与 UI 复杂度。13. 是否需要在 UI 加"在资源管理器中打开笔记所在文件夹"？（对 M2 体验提升明显，需要 opener 权限）

**关于分发** 14. 个人版是否与上游**共存安装**？若是，必须改 `identifier`（§10.5-2）。15. 分发的目标机器是**只有你自己**（Win11，WebView2 已有）还是**也要给别人**？决定是否需要 `webviewInstallMode` 内嵌。16. 内置更新器：改指向自己的 fork，还是个人版直接**关闭自动更新**（避免任何误升级）？17. 是否需要 `.md` 文件关联（`tauri.conf.json:56-69` 已配置）？若个人版不注册文件关联，双击 .md 会用 Typora 打开——这恰好更符合 M2 的工作流。

---

## 附：证据索引（按主题）

| 主题      | 关键位置                                                                  |
| --------- | ------------------------------------------------------------------------- |
| 编辑器    | `MainWindow.tsx:2971-2993`、`NotePad.tsx:874-900`                         |
| Toolbar   | `MainWindow.tsx:482-548`（数据）、`2946-2968`（渲染）                     |
| 格式命令  | `MainWindow.tsx:124-304`（`FormatAction` + `applyFormat`）                |
| Undo/Redo | `MainWindow.tsx:306-310`、`1654-1670`、`2751-2795`                        |
| 键盘      | `MainWindow.tsx:1228-1238`、`NotePad.tsx:565-575`、`App.tsx:53-63`        |
| 预览      | `MarkdownPreview.tsx:1-17`、`scrollSync.ts`、`imageSrc.ts:5-20`           |
| Note 模型 | `notes.rs:98-133`                                                         |
| 文件名    | `notes.rs:1322-1329`（`file_name_for`）、`1583-1608`（`safe_file_stem`）  |
| ID 推断   | `notes.rs:1624-1631`（`id_from_file_name`）、`1633-1646`（`infer_title`） |
| 路径      | `notes.rs:1301-1312`                                                      |
| CRUD      | `notes.rs:750-881`                                                        |
| 分类      | `notes.rs:980-1126`                                                       |
| 重建      | `notes.rs:1284-1443`                                                      |
| 图片      | `notes.rs:883-955`、`useImagePaste.ts`、`imageSrc.ts`                     |
| 迁移      | `notes.rs:261-453`、`1444-1548`                                           |
| 原子写    | `json_io.rs:10-28`                                                        |
| 命令注册  | `lib.rs:470-516`                                                          |
| 窗口/池   | `desktop.rs:1879-1889`、`1497-1630`                                       |
| 更新器    | `updater/check.rs:25-26`、`lib.rs:456-465`                                |
| 构建      | `tauri.conf.json`、`scripts/build-windows-local.ps1`、`Cargo.toml:46-57`  |

---

**M0 AUDIT: READY**

> 审计结论完整，M1/M2 的实施路径与风险已明确。
> 唯一前置阻塞：本机缺少 Rust 工具链与 `node_modules`，M0.5（构建环境就绪）须先完成，否则任何改动都无法获得构建级验证（见 §10.4、§12）。
