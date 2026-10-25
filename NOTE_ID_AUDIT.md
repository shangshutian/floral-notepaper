# Note ID Dependency Audit

> 目标：为「文件名从 `UUID_标题.md` 改为 `标题.md`」判断 UUID 是否仍是必需的稳定身份。
> 性质：**只读静态审计**。本轮未修改任何生产代码、未改 Storage、未做迁移、未 Git commit。
> 代码基线：`dev` @ `eaa39a5`。

---

## 0. 结论

`NOTE ID AUDIT: PASS`

- UUID **不是** UI 或前端契约的一部分 —— 前端身份早已是「不透明字符串」
  （管理笔记是 UUID，外部文件是绝对路径，`MainWindow.tsx:505`）。
- UUID **是**三件事的硬依赖：**图片目录 key**、**窗口 label**、**文件名唯一性**。
- 因此可行路线不是「淘汰 UUID」，而是「**UUID 留在 metadata，文件名只放标题**」（路线 B）。
- **不需要新增 `note-index.json`** —— `metadata.json` 已经就是这个索引（§3.3）。

---

## 1. UUID 依赖清单

### 1.1 生成（唯一一处与笔记身份有关）

| 位置           | 代码                         | 说明                     |
| -------------- | ---------------------------- | ------------------------ |
| `notes.rs:774` | `Uuid::new_v4().to_string()` | **笔记 id 的唯一生成点** |

其余三处 UUID 与笔记身份无关，不受本次改造影响：

| 位置                 | 用途                      |
| -------------------- | ------------------------- |
| `notes.rs:912`       | 图片文件名 `{uuid}.{ext}` |
| `desktop.rs:1880`    | 无 noteId 的便签窗 label  |
| `lib.rs:238`         | 背景图文件名              |
| `updater/mod.rs:335` | 更新请求 id               |

### 1.2 持久化（id 落在哪里）

| 载体                     | 内容                                                                                       | 代码                          |
| ------------------------ | ------------------------------------------------------------------------------------------ | ----------------------------- |
| `metadata.json`          | `{ notes: [{ id, title, fileName, category, createdAt, updatedAt, wordCount, preview }] }` | `notes.rs:113-123`、`693-695` |
| 文件名                   | `{id}_{safe_title}.md`                                                                     | `notes.rs:1327-1334`          |
| **笔记正文（内容内嵌）** | `images/{note_id}/{uuid}.png`                                                              | `notes.rs:915`                |
| `config.json`            | **不含任何 note id**（无 lastNote / activeNote）                                           | `notes.rs:25-100`             |

注意 `NoteMetadata` 同时有 `id` 和 `file_name` 两个字段 —— 说明当前设计里
**身份（id）和物理位置（file_name）本来就是分离的**，只是碰巧把 id 编进了文件名。

### 1.3 读取 / 传递

| 层次       | 位置                                                       | 形态                                                                             |
| ---------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Tauri 命令 | `lib.rs:19-62,136,175,201`                                 | 全部 `id: String` / `note_id: String`                                            |
| 存储层     | `find_metadata(id)` `notes.rs:1319-1325`，线性查找         | 唯一入口                                                                         |
| 前端 API   | `features/notes/api.ts`                                    | `getNote(id)` / `updateNote(id,…)` / `deleteNote(id)` / `moveNoteCategory(id,…)` |
| 前端状态   | `MainWindow.tsx` `selectedId` / `selectedIdRef`            | 不透明字符串                                                                     |
| 窗口路由   | `desktop.rs:1444` `?view=notepad&noteId={id}`、`1778` tile | 字符串拼进 URL                                                                   |
| 跨窗事件   | `desktop.rs:1163-1167` `tile-window-closed` 事件载荷       | 从窗口 label 反推 id                                                             |
| 拖拽       | `MainWindow.tsx:2248` `dataTransfer.getData("text/plain")` | id 当拖拽载荷                                                                    |

### 1.4 各功能域是否依赖 UUID

| 功能域               | 依赖方式                                                 | 换文件名后是否受影响  |
| -------------------- | -------------------------------------------------------- | --------------------- |
| **图片目录**         | `data_dir/images/{id}/`，且 `images/{id}/…` **写进正文** | **是（P1）**          |
| **窗口 label**       | `notepad-{sanitize(id)}` / `tile-{sanitize(id)}`         | **是（P0）**          |
| **编辑 / 保存**      | 全部经 `find_metadata(id)`                               | 否（只要 id 稳定）    |
| **删除**             | `delete_note(id)` + `delete_note_images(id)`             | 是（同上，见 P1）     |
| **重命名**           | 无独立入口，改标题即触发 `update_note` → 改 file_name    | **是（P0 重名覆盖）** |
| **Category**         | 按目录 `fs::rename` + 改 metadata.category               | 否                    |
| **搜索**             | `filterNotes` 用 `title/preview/fileName/displayTitle`   | 否（且会变好）        |
| **导入**             | 走 `create_note` → 新 UUID                               | 否                    |
| **导出**             | `read_note(id)` 读正文，输出文件名用标题                 | 否                    |
| **metadata rebuild** | 从文件名反推 id（`id_from_file_name`）                   | **是（P1）**          |
| **Tab**              | **不存在 tab 模型**，只有「选中笔记 + 独立窗口」         | 否                    |

### 1.5 `id_from_file_name()` 为什么存在

```rust
// notes.rs:1629-1636
fn id_from_file_name(file_name: &str) -> Option<String> {
    let stem = file_name.strip_suffix(".md")?;
    Some(stem.split_once('_').map(|(id, _)| id.to_string())
                        .unwrap_or_else(|| stem.to_string()))
}
```

唯一调用点是 `scan_dir_for_notes`（`notes.rs:1424`），而它只服务于 `rebuild_metadata`。
触发 rebuild 的路径有三条：

1. `metadata.json` 不存在（`notes.rs:1339-1343`）
2. `metadata.json` JSON 损坏 → 备份为 `metadata.corrupt-*.json` 后重建（`1347-1363`）
3. `metadata.json` 里 notes 为空但磁盘上有 `.md`（`ensure_storage`，`1289-1305`）

**根因**：`.md` 文件里没有任何身份信息（没有 frontmatter，`notes.rs` 全文无 frontmatter 处理），
所以一旦 metadata 丢失，身份只能从文件名捡回来。`id_from_file_name` 本质上是一个
**「穷人版 frontmatter」的补偿机制** —— 它存在，正是因为正文不自带身份。

同一处还有第二个隐含约定：`infer_title`（`1638-1651`）在正文没有 `# 标题` 时，
也用 `split_once('_')` 从文件名切标题。两个函数共享「`_` 前是 id、后是标题」这条隐式协议。

---

## 2. 去掉 UUID 文件名前缀的阻塞点

按严重度排序。P0 = 不解决就会数据损坏或功能错乱；P1 = 会退化但可接受；P2 = 细节。

### P0-1 重名会静默覆盖（数据丢失）

`update_note` 与 `create_note` 写文件时**都不检查目标是否已被占用**：

```rust
// notes.rs:831
fs::write(&new_path, &request.content)?;
```

今天 UUID 前缀是文件名唯一性的唯一保证。一旦前缀去掉：

- 两篇都叫「会议记录」→ 后者 `fs::write` 直接覆盖前者文件；
- 两条 metadata 的 `file_name` 指向同一个物理文件；
- 随后 `update_note` 的 `replaced_path` 逻辑（`861-865`）还可能把别人的文件丢进回收站。

必须在写入前做占用检查 + 唯一化（`标题.md` → `标题 (2).md`）。

### P0-2 窗口 label 依赖 ASCII id

```rust
// desktop.rs:1897-1910
fn sanitize_label_part(value: &str) -> String {
    // 非 ASCII 字母数字 → '-'
}
// desktop.rs:1877-1890
format!("notepad-{}", sanitize_label_part(id))
format!("tile-{}",        sanitize_label_part(id))
```

若 id 变成中文标题或文件路径：

- `「周报」` → 全部被替换成 `-` → `trim_matches('-')` 后为空 → label 变成裸 `notepad-`；
  所有中文标题笔记**共用同一个窗口 label**，窗口池互相顶替；
- `tile-` 同理；
- 关闭窗口时 `window.label().strip_prefix("tile-")`（`1163`）拿到的是**净化后**的字符串，
  于是 `tile-window-closed` 事件载荷与前端 `pinnedTileIds` 里的真实 id 对不上，
  pin 状态无法回收。

**只要 id 仍是 UUID（ASCII），这条永远不会触发** —— 这是保留 UUID 最强的工程理由。

### P0-3 「首个 `_` 切分」协议会截断标题

`id_from_file_name` 与 `infer_title` 都以第一个 `_` 为界。
新命名下 `我的_读书_笔记.md` → id 变成 `我的`、标题丢首段。
不是致命错误，但会产生**重复 id**（`我的_笔记.md` 与 `我的_日记.md` id 都是 `我的`），
进而让 `find_metadata` 命中错误对象。

### P1-1 图片目录以 UUID 为 key，且 UUID 写进了正文

```rust
// notes.rs:887-889
fn images_dir(&self, note_id: &str) -> PathBuf { data_dir.join("images").join(note_id) }
// notes.rs:915 —— 返回值写进 markdown 正文
Ok(format!("images/{note_id}/{file_name}"))
```

渲染时 `imageSrc.ts:19` 把 `images/<id>/x.png` 拼到 `data_dir` 后面直接读盘，
**不经过 metadata**。因此：

- 现有笔记的图片**不会**因为改名而立刻显示不出来（路径是字面量）；
- 但若 id 随标题变化：换标题后新粘贴的图片进新目录，正文出现两种前缀；
  `clean_unused_images(id)`（`926-959`）只清当前目录，旧目录变孤儿；
  `delete_note_images(id)`（`918-923`）同理，删笔记也清不掉旧图。

### P1-2 rebuild 是 id 的兜底，而兜底依赖文件名

id 只存在 `metadata.json`。一旦 metadata 丢失/损坏/为空，rebuild 会用
`id = 文件名词干` 重建。这条兜底链一旦断了，rebuild 只能生成新 id。
（同一处 `created_at` 也会退化成文件 mtime，这是今天就已存在的损失。）

### P1-3 多窗口持有旧 id

便签窗把 `editingNoteId` 存在自己的 state 里（`NotePad.tsx:134`、`342-346`）。
主窗改标题后若 id 变了，便签窗保存时 `updateNote(旧id)` → `noteNotFound`。
UUID 稳定时不存在这个问题。

### P2 其他

- `safe_file_stem` 截断到 48 字符（`1607`）并把非法字符换成 `_`：
  两个长标题前 48 字符相同时文件名相同 —— 与 P0-1 叠加。
- 搜索 `haystack` 含 `fileName`（`noteUtils.ts:95`），目前把 UUID 也搜进去了；
  改后反而更合理。
- `list_notes` 用 `file_name + category` 的存在性过滤（`743-751`），与 id 无关，不受影响。
- 外部文件已经用**绝对路径**当 id（`MainWindow.tsx:505`），并且能正常编辑/保存/导出。
  这证明前端身份机制本身不要求 UUID —— 只是一个反例佐证：
  `handlePinEntry`（`1754-1768`）没排除 `isExternal`，外部文件本来就会把路径塞进
  `tile-` label，属于**已存在的隐患**，与本次改造无关但同源。

---

## 3. A / B / C 判断

### 3.1 三条路线的真实成本

| 路线  | 含义                               | 代价                                                                                            | 风险点                                                |
| ----- | ---------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **A** | UUID 稳定 → frontmatter + metadata | 正文要**剥离/回填** YAML frontmatter：编辑区、预览、字数、preview、滚动同步、导入导出全部要感知 | 直接冲击刚收口的 M1.1（光标偏移、undo、command 语义） |
| **B** | UUID 仅内部身份 → metadata         | `file_name_for` 改标题制 + 唯一化 + rebuild 兼容                                                | id 在 metadata 丢失后无法恢复（P1-2）                 |
| **C** | 淘汰 UUID → 路径作身份             | 除 B 外还要重做窗口 label、跨窗事件回传、图片目录策略、重名策略                                 | P0-1/P0-2 全部要新机制兜底                            |

### 3.2 推荐：**B**，并把 A 留作后续升级路径

理由：

1. **目标匹配**。需求只是「文件名可读」，B 直接达成；A 为此付出 frontmatter 全链路成本。
2. **不碰 M1.1**。B 完全不改正文语义，`computeMarkdownEdit` / undo / IME / 快捷键零影响；
   A 会让「正文 = 用户输入」这条假设失效，风险面大一个量级。
3. **前端零改动**。前端身份已是不透明字符串，id 保持 UUID 则 URL、窗口 label、
   `selectedId`、跨窗事件全部不用动。
4. **图片天然安全**。id 不变 → `images/{id}/` 不变 → 旧图片、清理逻辑、删除逻辑全部照旧。
5. **改动集中**。B 的绝大多数工作量在 `notes.rs` 一个文件的 4 个函数里。

**为什么不是 C**：C 想去掉一层间接，但代价是把 P0-1（重名覆盖）和 P0-2（窗口 label）
从「UUID 顺便解决了」变成「必须显式解决」。路径身份还会让「改标题 = 改身份」，
而 Floral 的标题是随输入实时改的（900ms autosave 即触发 `update_note`），
等于高频改身份 —— 这是最坏的身份设计。

**A 什么时候才值得做**：当出现「用户把 `.md` 拷出 data 目录、再拷回来要保留身份/图片」这类需求时。
那时 frontmatter 是唯一正解，但应作为独立阶段，并且先解决「编辑器如何隐藏 frontmatter」。

### 3.3 是否真的需要 `note-index.json`：**不需要**

`metadata.json`（`notes.rs:693-695`）已经是完整的索引：

```
notes/文件名 ⇄ { id, title, fileName, category, createdAt, updatedAt, wordCount, preview }
```

它承担了 index 的全部职责：id → 物理位置、分类归属、排序时间、列表预览。
新增 `note-index.json` 只会产生**第二个真相源**，必须处理两者冲突/半写状态，
是纯粹为旧架构增加的复杂度，不带来任何新能力。

若未来采用 A，`metadata.json` 依然保留为可重建缓存，仍然不需要第三个文件。

---

## 4. 下一阶段最小改造范围

前提：走 B，保持 `NoteMetadata.id` 为 UUID，只改「文件名怎么来」。
**不改前端、不改 config、不改图片目录、不引入 frontmatter、不引入新索引文件。**

| #   | 改动                                                                                  | 文件 / 位置                                               |
| --- | ------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 1   | `file_name_for` 改为标题制：`{safe_title}.md`，空标题回落 `未命名.md`                 | `notes.rs:1327-1334`                                      |
| 2   | 新增「目标路径占用检查 + 唯一化」：被**其它** note 占用时加 ` (2)`/` (3)` 后缀        | `create_note` `notes.rs:772-809`、`update_note` `822-865` |
| 3   | `id_from_file_name` 改为「36 字符 UUID 形态则沿用，否则返回 None」                    | `notes.rs:1629-1636`                                      |
| 4   | `rebuild_metadata` / `scan_dir_for_notes`：无 id 时**生成新 UUID**（而非拿词干当 id） | `notes.rs:1391-1447`                                      |
| 5   | `infer_title` 去掉 `_` 切分，改为「`# ` 标题 → 整个词干」                             | `notes.rs:1638-1651`                                      |
| 6   | 一次性迁移：现存 `UUID_标题.md` → `标题.md`，metadata 保留原 id；重名加后缀           | 新增迁移函数，挂在 `ensure_storage` 之后                  |

**明确不做（留在 B 的边界外）**：

- 不改 `images_dir(note_id)` 与 `images/{id}/…` 正文格式 —— id 不变，图片全链路不动；
- 不改 `sanitize_label_part` / 窗口 label —— id 仍是 UUID；
- 不改任何 `src/` 前端文件 —— `fileName` 只在搜索里用到；
- 不改 `AppConfig` —— 它本来就不存 note id。

**验收要点**（下一阶段的测试重点）：

1. 两篇同名笔记可共存，保存互不覆盖，各自图片目录独立；
2. 旧笔记迁移后 id 不变（对比迁移前后 `metadata.json`），图片仍显示，`clean_unused_images` 仍生效；
3. 删掉 `metadata.json` 后重启：重建出的 id 是新 UUID，但正文里旧的 `images/{旧id}/` 仍能渲染
   （已知的、可接受的降级：孤儿目录，需在报告里写明）；
4. 便签窗 / 磁贴 / 跨窗事件在改名后仍正常（依赖 id 不变，应自动通过）。

---

## 附：证据索引

| 主题                 | 位置                                                               |
| -------------------- | ------------------------------------------------------------------ |
| id 生成              | `src-tauri/src/services/notes.rs:774`                              |
| 文件名规则           | `src-tauri/src/services/notes.rs:1327-1334`（`file_name_for`）     |
| 文件名 → id          | `src-tauri/src/services/notes.rs:1629-1636`（`id_from_file_name`） |
| 文件名 → 标题        | `src-tauri/src/services/notes.rs:1638-1651`（`infer_title`）       |
| 标题清洗 / 48 截断   | `src-tauri/src/services/notes.rs:1588-1613`（`safe_file_stem`）    |
| metadata 载入/重建   | `src-tauri/src/services/notes.rs:1336-1447`                        |
| 写入不查占用         | `src-tauri/src/services/notes.rs:831`                              |
| 图片目录             | `src-tauri/src/services/notes.rs:887-959`                          |
| 图片路径写进正文     | `src-tauri/src/services/notes.rs:915`                              |
| 窗口 label 净化      | `src-tauri/src/desktop.rs:1877-1910`                               |
| 跨窗事件回传         | `src-tauri/src/desktop.rs:1163-1167`                               |
| 前端外部文件 id=路径 | `src/components/MainWindow.tsx:505`                                |
| 搜索字段             | `src/features/notes/noteUtils.ts:90-100`                           |
| 图片渲染解析         | `src/features/markdown/imageSrc.ts:5-20`                           |
