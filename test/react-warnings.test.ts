// @vitest-environment happy-dom
import { act, createElement as h, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BookMeta } from "../src/core/index";
import { ReaderProvider } from "../src/react/index";

const books: BookMeta[] = [
  { id: "guide", title: "The Guide", authors: ["A. Writer"], chapters: [{ id: "intro", title: "Introduction", order: 1 }] },
];

function mount(ui: ReactNode, props: Record<string, unknown> = {}) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => {
    root.render(h(ReaderProvider, { books, manageTheme: false, toaster: false, ...props, children: ui }));
  });
  return root;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  window.history.replaceState({}, "", "/");
});

describe("ReaderProvider mount warning (§10.3)", () => {
  it("warns when mounted outside its basePath, once, and only in development", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("NODE_ENV", "development");
    window.history.replaceState({}, "", "/books/intro");

    mount(null, { options: { basePath: "/read" } });
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]![0]);
    expect(message).toContain('This reader\'s basePath is "/read", but it is mounted at /books/intro.');
    expect(message).toContain("Rename app/books/ to app/read/");
    expect(message).toContain('or set basePath back to "/books".');

    // Once per process.
    mount(null, { options: { basePath: "/read" } });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("stays quiet when mounted under its basePath, and outside development", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("NODE_ENV", "development");
    window.history.replaceState({}, "", "/read/guide/intro");
    mount(null, { options: { basePath: "/read" } });
    expect(warn).not.toHaveBeenCalled();
  });
});
