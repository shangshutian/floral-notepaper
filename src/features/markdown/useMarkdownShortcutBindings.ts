import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getConfig } from "../settings/api";
import {
  DEFAULT_MARKDOWN_SHORTCUTS,
  resolveMarkdownShortcutBindings,
  type MarkdownShortcutBindings,
} from "./shortcutBindings";

/**
 * 读取当前生效的 Markdown 快捷键绑定。
 *
 * MainWindow 与 NotePad 各自调用一次：初值取 `config_get`，
 * 之后跟随 `config-changed`（SettingsPanel 保存时由 MainWindow emit），
 * 所以两个窗口永远看到同一份配置，不需要额外的进程间通道。
 */

interface MarkdownShortcutConfigPayload {
  markdownShortcuts?: Record<string, string>;
}

export function useMarkdownShortcutBindings(): MarkdownShortcutBindings {
  const [bindings, setBindings] = useState<MarkdownShortcutBindings>(DEFAULT_MARKDOWN_SHORTCUTS);

  useEffect(() => {
    let cancelled = false;

    getConfig()
      .then((config) => {
        if (cancelled) return;
        setBindings(
          resolveMarkdownShortcutBindings(
            (config as MarkdownShortcutConfigPayload).markdownShortcuts,
          ),
        );
      })
      .catch(() => undefined);

    const unlisten = listen<MarkdownShortcutConfigPayload>("config-changed", (event) => {
      // 只有携带该字段时才更新，避免将来某个局部 config 广播把用户绑定重置成默认
      if (event.payload?.markdownShortcuts === undefined) return;
      setBindings(resolveMarkdownShortcutBindings(event.payload.markdownShortcuts));
    });

    return () => {
      cancelled = true;
      void unlisten.then((fn) => fn());
    };
  }, []);

  return bindings;
}
