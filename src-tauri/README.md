## Personal Fork Changes / 个人分支改动

This fork is based on Floral Notepaper and contains several changes focused on Markdown editing and local file usability.

本 Fork 基于 Floral Notepaper，主要针对 Markdown 编辑体验与本地文件可用性进行了增强。

### Markdown Editing

- Added configurable Markdown keyboard shortcuts.
- Added shortcuts for headings, lists, links, code, math, tables, bold and italic.
- Toolbar actions and keyboard shortcuts now share the same Markdown command system.
- Improved native Undo / Redo behavior.
- Markdown commands no longer insert unnecessary example or placeholder text.

Default shortcuts include:

- `Ctrl+B` — Bold
- `Ctrl+I` — Italic
- `Ctrl+K` — Link
- `Ctrl+1~6` — Headings
- `Ctrl+Shift+1/2` — Unordered / Ordered List
- `Ctrl+Shift+Q/W` — Inline Code / Code Block
- `Ctrl+Shift+S/A` — Inline Math / Block Math
- `Ctrl+Shift+B` — Table

### Human-readable Note Files

Note files now use readable filenames instead of UUID-prefixed filenames.

Before:

```
76092fc5-..._2025完型.md
```

Now:

```
2025完型.md
```

The internal UUID identity is still preserved in `metadata.json`, so existing window, image and note identity behavior remains unchanged.

Duplicate filenames are handled automatically:

```
英语.md`
`英语 (2).md`
`英语 (3).md
```

Existing UUID-prefixed notes are automatically migrated while preserving their original internal UUID.

### Storage Safety

The readable filename system includes additional protection against accidental overwrites:

- Atomic filename claiming for newly created paths.
- Concurrent notes with the same title cannot silently overwrite each other.
- Rename and category-move conflicts automatically receive numbered suffixes.
- Failed rename/write operations preserve the original note whenever possible.

### Current Status

- **M1 / M1.1 — Markdown Editing:** PASS
- **M2.0 — Human-readable Note Filenames:** PASS
- Live Preview prototype was evaluated but intentionally deferred.
- Nested folder/category restructuring is currently not planned.

The goal of this fork is to keep Floral lightweight while improving everyday Markdown note-taking and filesystem usability.
