/**
 * The Sandbox protocol: what the scratchpad (and later chapters) need from
 * anything that runs RunnableCode. The browser Sandbox (`zreader/sandbox/browser`)
 * is one implementation; a server Sandbox will be another. Browser-safe.
 */

export type SandboxLanguage = "python" | "javascript" | "typescript";

export const SANDBOX_LANGUAGES: readonly SandboxLanguage[] = ["python", "javascript", "typescript"];

/** Who wrote the RunnableCode: the reader (`scratchpad`) or the book's author (`chapter`). */
export type CodeSource = "scratchpad" | "chapter";

/** One run of a piece of RunnableCode. */
export interface RunRequest {
  /**
   * Which Kernel runs it, together with `language`: one Kernel per
   * (kernel, language). For pads this is the pad scope plus the browser tab.
   */
  kernel: string;
  /** Id of the RunnableCode being run. */
  runnableId: string;
  language: SandboxLanguage;
  code: string;
  codeSource: CodeSource;
}

/** What a run streams back, in order, ending with `exit` (or `restarted`). */
export type RunEvent =
  | { type: "stdout"; text: string }
  | { type: "stderr"; text: string }
  /** The value of the last expression, as text. */
  | { type: "result"; text: string }
  /** Rich output, such as an image. `data` is base64 for binary MIME types. */
  | { type: "display"; mime: string; data: string }
  | { type: "error"; name: string; message: string; traceback?: string }
  /** The Kernel was restarted (Stop, a timeout, idle shutdown): its variables are gone. */
  | { type: "restarted"; reason: "stopped" | "timeout" | "idle" | "crashed" }
  /** A progress message, such as the runtime downloading on first use. */
  | { type: "status"; text: string }
  /** The code itself started (after the Kernel, runtime and packages were ready). */
  | { type: "started" }
  | { type: "exit"; ok: boolean; ms: number };

export interface SandboxClient {
  /** Languages this Sandbox runs. */
  readonly languages: readonly SandboxLanguage[];
  /**
   * Runs code in its Kernel, starting the Kernel if needed. Runs in one Kernel
   * are queued. The stream ends after `exit`, or after `restarted` when the
   * Kernel is restarted mid-run (a Kernel restarted while idle reports
   * `restarted` at the start of the next run instead). Aborting `signal`
   * before `started` cancels the run; after that it only stops listening,
   * and `restart` stops the code.
   */
  run(request: RunRequest, options?: { signal?: AbortSignal }): AsyncIterable<RunEvent>;
  /** Ends a Kernel (and any run in it). The next run starts a new one. */
  restart(kernel: string, language: SandboxLanguage): Promise<void>;
  /** Ends every Kernel and frees the Sandbox. */
  dispose(): void;
}

/** Abilities a Sandbox doesn't have unless the site owner grants them (`reader.sandbox.permissions`). */
export interface DangerousPermissions {
  /** Origins code may reach (`fetch`, imports), or `true` for any. */
  network?: string[] | true;
  /** Python packages `micropip` may install, by name. */
  packages?: string[];
}

/** What the site's config tells a Sandbox, passed to `SandboxLoader.load`. */
export interface SandboxSettings {
  /** A run longer than this is stopped. `false`: no limit. */
  runTimeoutMs: number | false;
  /** A Kernel with no run for this long is shut down. `0` or `false`: never. */
  idleTimeoutMs: number | false;
  permissions: { scratchpad: { dangerousPermissions: DangerousPermissions } };
}

/**
 * How a Sandbox is offered to the reader: the languages it supports, known up
 * front for the editor, and a `load()` that creates the client on first run.
 */
export interface SandboxLoader {
  readonly languages: readonly SandboxLanguage[];
  /** Creates the client, applying the site's settings (options passed to the Sandbox itself win). */
  load(settings: SandboxSettings): Promise<SandboxClient>;
}

/** A loader with its client loaded once and shared; `dispose()` frees the client. */
export interface SandboxConnection {
  readonly languages: readonly SandboxLanguage[];
  client(): Promise<SandboxClient>;
  dispose(): void;
}

/**
 * Loads the client on first use and shares it. The owner (the provider) calls
 * `dispose()` to free it; a later `client()` loads a fresh one (React Strict
 * Mode unmounts and remounts the same provider).
 */
export function connectSandbox(loader: SandboxLoader, settings: SandboxSettings): SandboxConnection {
  let pending: Promise<SandboxClient> | null = null;
  return {
    languages: loader.languages,
    client() {
      if (!pending) {
        pending = loader.load(settings);
        pending.catch(() => (pending = null));
      }
      return pending;
    },
    dispose() {
      void pending?.then((c) => c.dispose(), () => {});
      pending = null;
    },
  };
}

/** Identifies this page load (one browser tab), so each tab gets its own Kernels. */
export const TAB_ID: string = (() => {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  return c?.randomUUID ? c.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
})();
