/**
 * Pure helpers for building agent references (no DOM, no React).
 */

export type BuiltInProvider = "chatgpt" | "claude" | "grok";

export interface ProviderSpec {
  id: string;
  label: string;
  /** URL that opens the assistant with `prompt` pre-filled. */
  href(prompt: string): string;
}

export const DEFAULT_PROMPT = "Refer the content at {url}";
export const DEFAULT_ASK_PROMPT = "Read from {url} so I can ask questions about it.";

export const PROVIDERS: Record<BuiltInProvider, ProviderSpec> = {
  chatgpt: { id: "chatgpt", label: "ChatGPT", href: (q) => `https://chatgpt.com/?hints=search&q=${encodeURIComponent(q)}` },
  claude: { id: "claude", label: "Claude", href: (q) => `https://claude.ai/new?q=${encodeURIComponent(q)}` },
  grok: { id: "grok", label: "Grok", href: (q) => `https://grok.com/?q=${encodeURIComponent(q)}` },
};

export const DEFAULT_PROVIDERS: BuiltInProvider[] = ["chatgpt", "claude", "grok"];

export function resolveProvider(p: BuiltInProvider | ProviderSpec): ProviderSpec {
  return typeof p === "string" ? PROVIDERS[p] : p;
}

/**
 * The `.md` twin of a page URL: drops the query and hash and any trailing
 * slash, then appends `.md` (`/` becomes `/index.md`).
 */
export function markdownUrl(pageUrl: string): string {
  const url = new URL(pageUrl);
  url.search = "";
  url.hash = "";
  let path = url.pathname.replace(/\/+$/, "");
  if (!path) path = "/index";
  if (!path.endsWith(".md")) path += ".md";
  url.pathname = path;
  return url.href;
}

/** Fill `{url}` in a prompt template (appends the URL when there is no placeholder). */
export function formatPrompt(template: string, url: string): string {
  return template.includes("{url}") ? template.replaceAll("{url}", url) : `${template} ${url}`.trim();
}

/** URL that opens an assistant with the prompt pre-filled. */
export function providerUrl(provider: BuiltInProvider | ProviderSpec, prompt: string): string {
  return resolveProvider(provider).href(prompt);
}
