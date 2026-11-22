/**
 * `zreader/sandbox/browser` — runs RunnableCode in the reader's own browser.
 *
 *   <ReaderRoot><ScratchpadSandbox />{children}</ReaderRoot>
 *   // or: <ReaderProvider sandbox={browserSandbox()}>
 *
 * Every Kernel runs in a worker inside one hidden, sandboxed iframe with an
 * opaque origin: code can't read the page, its storage or the reader's other
 * data, and can't reach the network unless the site grants it (ADR 0001).
 */
import { useMemo } from "react";
import type { SandboxLanguage, SandboxLoader } from "zreader";
import { useRegisterSandbox } from "zreader/react";
import { KernelHost, isFrameHandshake } from "./host";
import { frameMain, javascriptKernel, sourceOf } from "./kernels";
import { rewriteJavaScript } from "./rewrite";

export interface BrowserSandboxOptions {
  /** Languages to offer. Defaults to every language this Sandbox runs. */
  languages?: SandboxLanguage[];
  /** A run longer than this is stopped and its Kernel restarted. Default 30 s; `false`: no limit. */
  runTimeoutMs?: number | false;
  /** A Kernel with no run for this long is shut down. Default 15 minutes; `0` or `false`: never. */
  idleTimeoutMs?: number | false;
}

export const BROWSER_LANGUAGES: readonly SandboxLanguage[] = ["javascript"];

export const DEFAULT_RUN_TIMEOUT_MS = 30_000;
export const DEFAULT_IDLE_TIMEOUT_MS = 15 * 60_000;

/** The frame's Content-Security-Policy: no network except the given origins. */
export function kernelCsp({ connect = [] }: { connect?: string[] | "*" } = {}): string {
  const origins = connect === "*" ? "*" : connect.join(" ");
  return [
    "default-src 'none'",
    `script-src blob: 'unsafe-eval' 'wasm-unsafe-eval'${origins ? ` ${origins}` : ""}`,
    "worker-src blob:",
    `connect-src ${origins || "'none'"}`,
  ].join("; ");
}

let acorn: Promise<typeof import("acorn")> | null = null;
const loadAcorn = () => (acorn ??= import("acorn"));

async function prepare(language: SandboxLanguage, code: string): Promise<string> {
  if (language === "javascript") return rewriteJavaScript(code, await loadAcorn());
  return code;
}

/** Opens the hidden sandboxed iframe and waits for it to hand over its port. */
function openFrame(config: Parameters<typeof frameMain>[0]): Promise<{ port: MessagePort; close(): void }> {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-scripts");
  iframe.setAttribute("aria-hidden", "true");
  iframe.tabIndex = -1;
  iframe.title = "zreader sandbox";
  iframe.style.cssText = "position:absolute;width:0;height:0;border:0;visibility:hidden";
  const script = sourceOf(frameMain, config).replace(/<\/script/gi, "<\\/script");
  iframe.srcdoc = `<!doctype html><meta charset="utf-8"><script>${script}</script>`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      iframe.remove();
      reject(new Error("the sandbox frame didn't start"));
    }, 15_000);
    const onMessage = (e: MessageEvent) => {
      if (!isFrameHandshake(e, iframe.contentWindow)) return;
      cleanup();
      resolve({ port: e.ports[0]!, close: () => iframe.remove() });
    };
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
    };
    window.addEventListener("message", onMessage);
    document.body.append(iframe);
  });
}

/** A Sandbox that runs RunnableCode in this browser. */
export function browserSandbox(options: BrowserSandboxOptions = {}): SandboxLoader {
  const languages = (options.languages ?? BROWSER_LANGUAGES).filter((l) => BROWSER_LANGUAGES.includes(l));
  return {
    languages,
    load: async () =>
      new KernelHost({
        languages,
        prepare,
        runTimeoutMs: options.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS,
        idleTimeoutMs: options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
        openFrame: () =>
          openFrame({
            csp: kernelCsp(),
            kernels: { javascript: sourceOf(javascriptKernel) },
          }),
      }),
  };
}

export type ScratchpadSandboxProps = BrowserSandboxOptions;

/** Turns on RunnableCode in the scratchpad, run in this browser. Render it inside `<ReaderRoot>` / `<ReaderProvider>`. Renders nothing. */
export function ScratchpadSandbox(props: ScratchpadSandboxProps) {
  const key = JSON.stringify(props);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const loader = useMemo(() => browserSandbox(JSON.parse(key) as BrowserSandboxOptions), [key]);
  useRegisterSandbox(loader);
  return null;
}

export { KernelHost, isFrameHandshake } from "./host";
export type { KernelHostOptions } from "./host";
