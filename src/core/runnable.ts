/**
 * Pure helpers for RunnableCode shared by the scratchpad and chapters: how an
 * Output is folded from run events, cut, and written as Markdown. Browser-safe.
 */
import type { RunEvent, SandboxLanguage } from "./sandbox";

/** Output longer than this is cut in the pad, with a marker. */
export const OUTPUT_LIMIT = 8000;
export const TRUNCATED_MARKER = "… [output truncated]";

export const LANGUAGE_LABELS: Record<SandboxLanguage, string> = { python: "Python", javascript: "JavaScript", typescript: "TypeScript" };

export function newRunnableId(): string {
  return Math.random().toString(36).slice(2, 8).padEnd(6, "0");
}

/** Cuts Output to `OUTPUT_LIMIT` characters, marking the cut. */
export function truncateOutput(text: string): string {
  if (text.length <= OUTPUT_LIMIT) return text;
  return `${text.slice(0, OUTPUT_LIMIT).replace(/\n?$/, "\n")}${TRUNCATED_MARKER}`;
}

/** A backtick fence longer than any run of backticks in `text`. */
function fenceFor(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((r) => r.length));
  return "`".repeat(Math.max(3, longest + 1));
}

export function renderRunnableMarkdown(attrs: { language: SandboxLanguage; runnableId: string; output: string | null; displays?: string[] | null }, code: string): string {
  const f = fenceFor(code);
  const parts = [`${f}${attrs.language} run id=${attrs.runnableId}`, ...(code ? [code] : []), f];
  if (attrs.output) {
    const o = fenceFor(attrs.output);
    parts.push(`${o}output for=${attrs.runnableId}`, attrs.output, o);
  }
  for (const src of attrs.displays ?? []) parts.push(`![output](${src})`);
  return parts.join("\n");
}

/** Folds a run's events into the text saved as its Output. */
export function outputText(events: readonly RunEvent[]): string {
  let out = "";
  for (const e of events) {
    if (e.type === "stdout" || e.type === "stderr") out += e.text;
    else if (e.type === "result") out += (out && !out.endsWith("\n") ? "\n" : "") + e.text + "\n";
    else if (e.type === "error") out += (out && !out.endsWith("\n") ? "\n" : "") + (e.traceback ?? `${e.name}: ${e.message}`) + "\n";
  }
  return out.replace(/\n+$/, "");
}

export const RESTART_NOTICE: Record<string, string> = {
  stopped: "Kernel restarted, variables cleared.",
  timeout: "The run took too long and was stopped. Kernel restarted, variables cleared.",
  idle: "The Kernel was idle and shut down. Kernel restarted, variables cleared.",
  crashed: "The Kernel stopped unexpectedly. Kernel restarted, variables cleared.",
};

/** Images shown and kept from a run: raster only, since an SVG could run script if opened on its own. */
export const isRaster = (mime: string) => /^image\/(png|jpeg|gif|webp)$/.test(mime);

