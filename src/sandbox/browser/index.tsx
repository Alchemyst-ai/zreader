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
import { useMemo, useRef } from "react";
import type { SandboxLanguage, SandboxLoader } from "zreader";
import { useRegisterSandbox } from "zreader/react";
import { KernelHost, isFrameHandshake } from "./host";
import { frameMain, javascriptKernel, pythonKernel, sourceOf } from "./kernels";
import { rewriteJavaScript } from "./rewrite";

export interface BrowserSandboxOptions {
  /** Languages to offer. Defaults to every language this Sandbox runs. */
  languages?: SandboxLanguage[];
  /** A run longer than this is stopped and its Kernel restarted. Default 30 s; `false`: no limit. */
  runTimeoutMs?: number | false;
  /** A Kernel with no run for this long is shut down. Default 15 minutes; `0` or `false`: never. */
  idleTimeoutMs?: number | false;
  /**
   * Where Pyodide (the Python runtime) is loaded from: a folder with `pyodide.mjs`,
   * ending in "/". Defaults to a pinned jsDelivr URL. To self-host, serve the files
   * of the `pyodide` npm package (same version) with CORS allowed, since the
   * Sandbox frame has an opaque origin.
   */
  pyodideIndexURL?: string;
  /**
   * Turns on TypeScript: a loader for `sucrase` (an optional peer dependency),
   * which strips types before the code runs as JavaScript. Pass
   * `() => import("sucrase")`; sites without it don't need sucrase installed.
   */
  typescript?: () => Promise<SucraseLike>;
}

/** The part of `sucrase` the TypeScript Kernel uses. */
export interface SucraseLike {
  transform(code: string, options: { transforms: string[]; disableESTransforms?: boolean }): { code: string };
}

export const BROWSER_LANGUAGES: readonly SandboxLanguage[] = ["python", "javascript", "typescript"];

/** The Pyodide release the Python Kernel is tested with. */
export const PYODIDE_VERSION = "314.0.8";
export const DEFAULT_PYODIDE_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

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

/** Strips TypeScript types with sucrase, reporting syntax errors like the JavaScript rewrite does. */
export function stripTypes(code: string, sucrase: SucraseLike): string {
  try {
    return sucrase.transform(code, { transforms: ["typescript"], disableESTransforms: true }).code;
  } catch (err) {
    throw new SyntaxError(String((err as Error)?.message ?? err));
  }
}

function preparer(typescript: BrowserSandboxOptions["typescript"]) {
  let sucrase: Promise<SucraseLike> | null = null;
  return async (language: SandboxLanguage, code: string): Promise<string> => {
    if (language === "javascript") return rewriteJavaScript(code, await loadAcorn());
    if (language === "typescript") {
      if (!typescript) throw new Error("TypeScript isn't turned on for this Sandbox");
      sucrase ??= typescript().then((m) => (m as SucraseLike & { default?: SucraseLike }).default ?? m);
      sucrase.catch(() => (sucrase = null));
      return rewriteJavaScript(stripTypes(code, await sucrase), await loadAcorn());
    }
    return code;
  };
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

/** What the Sandbox frame is started with: its CSP and the Kernel sources. */
export function frameConfig(options: BrowserSandboxOptions & { languages: readonly SandboxLanguage[] }): Parameters<typeof frameMain>[0] {
  const indexURL = new URL(options.pyodideIndexURL ?? DEFAULT_PYODIDE_INDEX_URL, location.href).href.replace(/\/?$/, "/");
  return {
    csp: kernelCsp({ connect: options.languages.includes("python") ? [new URL(indexURL).origin] : [] }),
    kernels: { javascript: sourceOf(javascriptKernel), typescript: sourceOf(javascriptKernel), python: sourceOf(pythonKernel, { indexURL }) },
  };
}

/** A Sandbox that runs RunnableCode in this browser. */
export function browserSandbox(options: BrowserSandboxOptions = {}): SandboxLoader {
  const languages = (options.languages ?? BROWSER_LANGUAGES).filter((l) => BROWSER_LANGUAGES.includes(l) && (l !== "typescript" || !!options.typescript));
  return {
    languages,
    load: async () =>
      new KernelHost({
        languages,
        prepare: preparer(options.typescript),
        runTimeoutMs: options.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS,
        idleTimeoutMs: options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
        openFrame: () => openFrame(frameConfig({ ...options, languages })),
      }),
  };
}

export type ScratchpadSandboxProps = BrowserSandboxOptions;

/** Turns on RunnableCode in the scratchpad, run in this browser. Render it inside `<ReaderRoot>` / `<ReaderProvider>`. Renders nothing. */
export function ScratchpadSandbox({ typescript, ...props }: ScratchpadSandboxProps) {
  // A new loader restarts every Kernel, so key it on the options' values, not identities.
  const key = JSON.stringify(props);
  const ts = useRef(typescript);
  ts.current = typescript;
  const hasTs = !!typescript;
  const loader = useMemo(
    () => browserSandbox({ ...(JSON.parse(key) as BrowserSandboxOptions), typescript: hasTs ? () => ts.current!() : undefined }),
    [key, hasTs],
  );
  useRegisterSandbox(loader);
  return null;
}

export { KernelHost, isFrameHandshake } from "./host";
export type { KernelHostOptions } from "./host";
