import type { ReaderClientOptions } from "./types";

export const DEFAULT_CLIENT_OPTIONS: ReaderClientOptions = {
  storagePrefix: "zr",
  highlightColors: ["yellow", "green", "blue", "pink"],
  defaultHighlightColor: "yellow",
  scratchpad: { enabled: true, scopes: ["chapter", "book", "global"] },
  userImages: { enabled: true, maxBytes: 10 * 1024 * 1024 },
  offline: { enabled: false, serviceWorker: "/zreader-sw.js" },
  themes: ["system", "light", "sepia", "dark"],
  defaultTheme: "system",
  defaultSettings: {
    textSize: "lg",
    leading: "relaxed",
    measure: "normal",
    fontFamily: "serif",
    highlightMode: false,
  },
  progress: { completeAt: 0.9, saveIntervalMs: 1000 },
  backupReminder: true,
  basePath: "/books",
  sandbox: {
    scopes: { global: "browser", book: "browser", chapter: "browser" },
    kernel: { idleTimeoutMs: 15 * 60_000, runTimeoutMs: 30_000 },
    permissions: { scratchpad: { dangerousPermissions: {} } },
  },
};
