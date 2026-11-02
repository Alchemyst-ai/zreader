import { createElement as h, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BookMeta } from "../src/core/index";
import {
  BookContents,
  BookShelf,
  ChapterList,
  Reader,
  ReaderProvider,
  ReaderTitle,
  useReaderChapter,
  type ReaderProviderProps,
} from "../src/react/index";

const books: BookMeta[] = [
  {
    id: "guide",
    title: "The Guide",
    authors: ["A. Writer"],
    description: "A short guide.",
    chapters: [
      { id: "intro", title: "Introduction", order: 1 },
      { id: "middle", title: "The Middle", order: 2, part: "Part I", label: "Chapter 2", number: "2" },
      { id: "end", title: "The End", order: 3 },
    ],
  },
];

/** React-only: no Next.js, no Node APIs, just the provider. */
const render = (ui: ReactNode, props: Partial<ReaderProviderProps> = {}) =>
  renderToString(h(ReaderProvider, { books, manageTheme: false, toaster: false, ...props, children: ui }));

describe("ReaderProvider (React only)", () => {
  it("renders the shelf from the provider's catalogue", () => {
    const html = render(h(BookShelf, { embedded: true }));
    expect(html).toContain("The Guide");
    expect(html).toContain('href="/books/guide"');
    expect(html).toMatch(/3(<!-- -->)? chapters/);
  });

  it("resolves a contents page by id, grouped by part", () => {
    const html = render(h(BookContents, { book: "guide", embedded: true }));
    expect(html).toContain("Introduction");
    expect(html).toContain("Part I");
    expect(html).toContain('href="/books/guide/middle"');
  });

  it("uses the provider's Link and hrefFor everywhere", () => {
    const Link = ({ href, children, ...rest }: { href: string; children?: ReactNode }) =>
      h("a", { ...rest, href, "data-router": "yes" }, children);
    const html = render(h(ChapterList, { book: "guide" }), {
      Link,
      hrefFor: (b, c) => (c ? `/read/${b}/${c}` : `/read/${b}`),
    });
    expect(html).toContain('href="/read/guide/intro"');
    expect(html).toContain('data-router="yes"');
  });

  it("props override the provider", () => {
    const html = render(h(ChapterList, { book: "guide", hrefFor: (b, c) => `/x/${b}/${c}` }));
    expect(html).toContain('href="/x/guide/end"');
  });

  it("explains unknown ids and a missing catalogue", () => {
    expect(() => render(h(BookContents, { book: "nope" }))).toThrow(/no book with id "nope".*Known: guide/);
    expect(() => render(h(BookContents, { book: "guide" }), { books: [] })).toThrow(/needs the catalogue/);
  });
});

describe("<Reader> from ids", () => {
  const reader = (props: Record<string, unknown> = {}, provider: Partial<ReaderProviderProps> = {}) =>
    render(h(Reader, { book: "guide", chapter: "middle", children: h("p", null, "Body text."), ...props }), provider);

  it("derives prev/next and the eyebrow from the catalogue", () => {
    const html = reader();
    expect(html).toContain("Body text.");
    expect(html).toContain('href="/books/guide/intro"'); // previous
    expect(html).toContain('href="/books/guide/end"'); // next
    expect(html).toContain("Part I");
    expect(html).toContain("Chapter 2");
  });

  it("header slot: default titles, string, element, function, provider default", () => {
    expect(reader()).toContain("The Guide");
    expect(reader({ header: "Press reading room" })).toContain("Press reading room");
    expect(reader({ header: h("span", { className: "logo" }, "LOGO") })).toContain('<span class="logo">LOGO</span>');
    expect(reader({ header: ({ chapter }: { chapter: { title: string } }) => `Now: ${chapter.title}` })).toContain("Now: The Middle");
    expect(reader({}, { headerSlot: h("b", null, "From provider") })).toContain("<b>From provider</b>");
    expect(reader({ header: h("i", null, "Per reader") }, { headerSlot: h("b", null, "From provider") })).toContain("<i>Per reader</i>");
  });

  it("ReaderTitle composes with custom header content", () => {
    const html = reader({ header: h("div", null, h("span", null, "LOGO"), h(ReaderTitle)) });
    expect(html).toContain("LOGO");
    expect(html).toContain("The Middle");
  });

  it("fails clearly for an unknown chapter", () => {
    expect(() => reader({ chapter: "missing" })).toThrow(/has no chapter "missing"/);
  });

  it("useReaderChapter throws outside <Reader>", () => {
    const Probe = () => {
      useReaderChapter();
      return null;
    };
    expect(() => render(h(Probe))).toThrow(/inside <Reader>/);
  });
});
