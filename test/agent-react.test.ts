// @vitest-environment happy-dom
import { act, createElement as h, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BookMeta } from "../src/core/index";
import { Reader, ReaderProvider, type ReaderProviderProps } from "../src/react/index";
import { CopyReference, MarkdownAlternate, PROVIDERS, formatPrompt, markdownHref, markdownUrl, providerUrl } from "../src/agent/react/index";
import { ReaderRoot } from "../src/next/server/index";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const books: BookMeta[] = [
  {
    id: "context-infrastructure",
    title: "Context Infrastructure",
    authors: [],
    chapters: [
      { id: "intro", title: "Introduction", order: 1 },
      { id: "appendix-a-api-endpoint-reference", title: "API Endpoint Reference", order: 2 },
    ],
  },
];

const tree = (actions: ReactNode | undefined, props: Partial<ReaderProviderProps> = {}) =>
  h(ReaderProvider, {
    books,
    manageTheme: false,
    toaster: false,
    ...props,
    children: h(Reader, {
      book: "context-infrastructure",
      chapter: "appendix-a-api-endpoint-reference",
      ...(actions !== undefined ? { actions } : {}),
      children: h("p", null, "Body"),
    }),
  });
const topBar = (html: string) => html.slice(html.indexOf("<header"), html.indexOf("</header>"));

describe("reference helpers", () => {
  it("maps page URLs to their .md twin", () => {
    expect(markdownUrl("https://press.example.com/books/b/c")).toBe("https://press.example.com/books/b/c.md");
    expect(markdownUrl("https://press.example.com/books/b/c/?x=1#hl-2")).toBe("https://press.example.com/books/b/c.md");
    expect(markdownUrl("https://press.example.com/books/b/c.md")).toBe("https://press.example.com/books/b/c.md");
    expect(markdownUrl("https://press.example.com/")).toBe("https://press.example.com/index.md");
  });

  it("fills prompts and builds provider links", () => {
    const url = "https://getalchemystai.com/docs/integrations/extensions/chrome";
    const prompt = formatPrompt("Read from {url} so I can ask questions about it.", url);
    expect(providerUrl("chatgpt", prompt)).toBe(
      "https://chatgpt.com/?hints=search&q=Read%20from%20https%3A%2F%2Fgetalchemystai.com%2Fdocs%2Fintegrations%2Fextensions%2Fchrome%20so%20I%20can%20ask%20questions%20about%20it.",
    );
    expect(providerUrl("claude", "hi")).toBe("https://claude.ai/new?q=hi");
    expect(providerUrl("grok", "hi")).toBe("https://grok.com/?q=hi");
    expect(providerUrl({ id: "x", label: "X", href: (q) => `https://x.test/?p=${q}` }, "hi")).toBe("https://x.test/?p=hi");
    expect(formatPrompt("See", "u")).toBe("See u");
    expect(Object.keys(PROVIDERS)).toEqual(["chatgpt", "claude", "grok"]);
  });
});

describe("<CopyReference>", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("renders in the reader's top bar via `actions`", () => {
    const html = renderToString(tree(h(CopyReference, { markdown: true })));
    const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
    expect(header).toContain("data-zr-copy-reference");
    expect(header).toContain('aria-label="Copy reference"');
    expect(header).toContain('aria-label="Reference options"');
  });

  async function clickCopy(actions: ReactNode, props: Partial<ReaderProviderProps> = {}) {
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => root.render(tree(actions, props)));
    const button = el.querySelector<HTMLButtonElement>('[data-zr-copy-reference] button[aria-label="Copy reference"]')!;
    await act(async () => button.click());
    await act(async () => root.unmount());
    return writeText.mock.calls[0]?.[0] as string | undefined;
  }

  it("copies the prompt with the chapter's .md URL", async () => {
    const origin = window.location.origin;
    expect(await clickCopy(h(CopyReference, { markdown: true }))).toBe(
      `Refer the content at ${origin}/books/context-infrastructure/appendix-a-api-endpoint-reference.md`,
    );
  });

  it("uses the page URL without `markdown`, and honours hrefFor and custom prompts", async () => {
    const origin = window.location.origin;
    expect(await clickCopy(h(CopyReference, { prompt: "Use {url} please" }), { hrefFor: (b, c) => `/read/${b}/${c ?? ""}` })).toBe(
      `Use ${origin}/read/context-infrastructure/appendix-a-api-endpoint-reference please`,
    );
  });

  it("accepts a custom page → Markdown mapping", async () => {
    expect(await clickCopy(h(CopyReference, { markdown: () => "https://cdn.example.com/x.md" }))).toBe(
      "Refer the content at https://cdn.example.com/x.md",
    );
  });
});

describe("provider readerActions", () => {
  const Btn = (label: string) => h("button", { "data-test": label }, label);

  it("renders the provider's actions in every reader", () => {
    expect(topBar(renderToString(tree(undefined, { readerActions: Btn("global") })))).toContain('data-test="global"');
  });

  it("a chapter's actions replace them, and null hides them", () => {
    const replaced = topBar(renderToString(tree(Btn("local"), { readerActions: Btn("global") })));
    expect(replaced).toContain('data-test="local"');
    expect(replaced).not.toContain('data-test="global"');
    expect(topBar(renderToString(tree(null, { readerActions: Btn("global") })))).not.toContain("data-test");
  });
});

describe("<MarkdownAlternate>", () => {
  it("links the chapter's .md twin, following hrefFor", () => {
    expect(renderToString(tree(h(MarkdownAlternate)))).toContain(
      '<link rel="alternate" type="text/markdown" href="/books/context-infrastructure/appendix-a-api-endpoint-reference.md"',
    );
    expect(renderToString(tree(h(MarkdownAlternate), { hrefFor: (b, c) => `/read/${b}/${c ?? ""}` }))).toContain(
      'href="/read/context-infrastructure/appendix-a-api-endpoint-reference.md"',
    );
  });

  it("renders nothing outside <Reader>", () => {
    expect(renderToString(h(ReaderProvider, { books, manageTheme: false, toaster: false, children: h(MarkdownAlternate) }))).not.toContain("<link");
  });

  it("markdownHref strips hashes, queries and trailing slashes", () => {
    expect(markdownHref("/books/b/c#hl-1")).toBe("/books/b/c.md");
    expect(markdownHref("/books/b/c/?x=1")).toBe("/books/b/c.md");
    expect(markdownHref("/")).toBe("/index.md");
  });
});

describe("<ReaderRoot agent>", () => {
  type El = { props: { readerActions?: { props: { children: Array<{ type: unknown; props: Record<string, unknown> } | ReactNode> } } | ReactNode } };
  const actionsOf = async (props: Record<string, unknown>) =>
    ((await ReaderRoot({ books, children: null, ...props } as never)) as unknown as El).props.readerActions;

  it("adds the alternate link and a Markdown CopyReference before the app's actions", async () => {
    const mine = h("button", null, "mine");
    const actions = (await actionsOf({ agent: { label: "Cite", providers: ["claude"] }, readerActions: mine })) as {
      props: { children: Array<{ type: unknown; props: Record<string, unknown> }> };
    };
    const [link, copy, extra] = actions.props.children;
    expect(link!.type).toBe(MarkdownAlternate);
    expect(copy!.type).toBe(CopyReference);
    expect(copy!.props).toMatchObject({ markdown: true, label: "Cite", providers: ["claude"] });
    expect(extra).toBe(mine);
  });

  it("passes readerActions through unchanged without agent", async () => {
    const mine = h("button", null, "mine");
    expect(await actionsOf({ readerActions: mine })).toBe(mine);
    expect(await actionsOf({ agent: false })).toBeUndefined();
  });
});
