# Copy Reference

`zreader/agent/react` adds a **Copy reference** button to the reader's top bar, so readers can hand a chapter to an AI assistant in one click.

- The button copies a prompt: `Refer the content at https://…/appendix-a-api-endpoint-reference.md`.
- Its menu has:
  - **Copy reference**: the same prompt.
  - **Copy Markdown URL** (or **Copy link**): the URL alone.
  - **Open in ChatGPT / Claude / Grok**: opens the assistant in a new tab with `Read from <url> so I can ask questions about it.` pre-filled.

A toast confirms each copy and shows what was copied.

## `<ReaderRoot agent>`

In Next.js, one flag turns it on for every chapter:

```tsx
// app/books/layout.tsx
<ReaderRoot agent>{children}</ReaderRoot>
```

`agent` adds, to every chapter:

- `<CopyReference markdown />` in the top bar, before the bookmark toggle;
- `<MarkdownAlternate />`: a `<link rel="alternate" type="text/markdown">` tag in `<head>`.

Anything you pass in `readerActions` renders after the button. A chapter's own `actions` replaces both (`actions={null}` hides them).

Customise it with plain values (a server component can only pass serializable props to the client):

```tsx
<ReaderRoot
  agent={{
    prompt: "Use {url} as context for my questions.",
    askPrompt: "Read {url} and summarise it.",
    providers: ["chatgpt", "claude"],
    label: "Cite",
  }}
>
```

`agent` is off by default, because the `.md` URLs only work once your proxy serves them; see [Agent-readable content](./agent.md#nextjs). For custom providers, render `<CopyReference>` yourself.

## `<CopyReference>`

```tsx
import { CopyReference } from "zreader/agent/react";

<ReaderProvider books={books} readerActions={<CopyReference markdown />}>
```

| Prop | Type | Default | |
| --- | --- | --- | --- |
| `markdown` | `boolean \| (pageUrl) => string` | `false` | `true`: reference the page's `.md` twin. `false`: reference the page URL. A function: map the page URL to a Markdown URL yourself |
| `prompt` | string | `"Refer the content at {url}"` | The copied text. `{url}` is replaced; without a placeholder the URL is appended |
| `askPrompt` | string | `"Read from {url} so I can ask questions about it."` | Sent to the assistants |
| `providers` | `("chatgpt" \| "claude" \| "grok" \| ProviderSpec)[]` | `["chatgpt", "claude", "grok"]` | Assistants in the menu, in order. `[]` hides the section |
| `label` | string | `"Copy reference"` | Button text and accessible name |
| `className` | string | | |

### Which URL it references

The URL is built **when clicked**, so server rendering never touches `window`:

1. The page URL: inside `<Reader>`, the reader's `hrefFor(book, chapter)` resolved against `location.origin`, so custom routes work. Outside a reader, `location.href`. The hash is dropped.
2. With `markdown`, its twin: query, hash and trailing slash removed, then `.md` appended.

| Setup | Use |
| --- | --- |
| A server runs `createAgentHandler()` | `markdown` (or `<ReaderRoot agent>`) |
| No server for `.md` (static hosting) | No `markdown`: the button copies the page URL |
| Markdown hosted elsewhere | `markdown={(pageUrl) => pageUrl.replace("https://app.example.com", "https://docs.example.com") + ".md"}` |
| Hash routing (`#/read/…`) | The function form; the default can't derive a twin from a hash URL |

Turning on `markdown` without serving the twins gives readers links that 404.

### Providers

| Id | Opens |
| --- | --- |
| `chatgpt` | `https://chatgpt.com/?hints=search&q=<prompt>` |
| `claude` | `https://claude.ai/new?q=<prompt>` |
| `grok` | `https://grok.com/?q=<prompt>` |

The prompt is URL-encoded. For example, for `https://getalchemystai.com/docs/integrations/extensions/chrome`:

```
https://chatgpt.com/?hints=search&q=Read%20from%20https%3A%2F%2Fgetalchemystai.com%2Fdocs%2Fintegrations%2Fextensions%2Fchrome%20so%20I%20can%20ask%20questions%20about%20it.
```

These query parameters are how the assistants pre-fill a prompt today; Claude and Grok don't document theirs. If one changes, replace it with a custom provider:

```tsx
<CopyReference
  markdown
  providers={[
    "chatgpt",
    { id: "perplexity", label: "Perplexity", href: (prompt) => `https://www.perplexity.ai/search?q=${encodeURIComponent(prompt)}` },
  ]}
/>
```

Links open with `noopener,noreferrer`.

### Layout

- From the `sm` breakpoint (640px): an icon button that copies, plus a chevron for the menu.
- From `lg` (1024px): the button also shows its label.
- Below `sm`: only the menu button, whose first item is **Copy reference**.

Classes come from the package, so they're covered by `zreader/styles.css` and by `zreader/tailwind.css` (which scans the package). The root element has `data-zr-copy-reference` for your own CSS.

## `<MarkdownAlternate>`

```tsx
import { MarkdownAlternate } from "zreader/agent/react";

<ReaderProvider books={books} readerActions={<><MarkdownAlternate /><CopyReference markdown /></>}>
```

Renders `<link rel="alternate" type="text/markdown" href="/books/<book>/<chapter>.md" title="<chapter title>">` for the current chapter, built from `hrefFor`. React 19 hoists it into `<head>`, during server rendering too. Outside a `<Reader>` it renders nothing. Use it only when the twins are served.

## Helpers

For your own buttons:

| Export | |
| --- | --- |
| `markdownUrl(pageUrl)` | Absolute page URL → `.md` URL (`/` → `/index.md`) |
| `markdownHref(href)` | Same for relative hrefs |
| `formatPrompt(template, url)` | Fills `{url}` |
| `providerUrl(provider, prompt)` | Provider id or spec → URL |
| `PROVIDERS`, `DEFAULT_PROVIDERS`, `resolveProvider` | The built-in providers |
| `DEFAULT_PROMPT`, `DEFAULT_ASK_PROMPT` | The default templates |

```tsx
import { formatPrompt, markdownUrl, providerUrl } from "zreader/agent/react";

const md = markdownUrl(location.href);
window.open(providerUrl("claude", formatPrompt("Summarise {url}", md)));
```
