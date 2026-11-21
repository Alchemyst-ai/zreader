// @vitest-environment happy-dom
import { act, createElement as h, useState } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { BookShelf, ImageViewer, ReaderProvider, describeImage, useImageViewer } from "../src/react/index";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Harness({ html }: { html: string }) {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const viewer = useImageViewer(root);
  return h("div", null, h("article", { ref: setRoot, dangerouslySetInnerHTML: { __html: html } }), h(ImageViewer, { image: viewer.image, onClose: viewer.close, returnFocus: viewer.trigger }));
}

let container: HTMLDivElement;
afterEach(() => {
  container?.remove();
  document.body.innerHTML = "";
});

async function mount(html: string) {
  container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(Harness, { html })));
  return root;
}

describe("image viewer", () => {
  it("describes an image, preferring the largest srcset candidate and the figure caption", () => {
    document.body.innerHTML = `<figure><img alt="Map" src="/a.png" srcset="/a-640.png 640w, /a-1920.png 1920w, /a-1080.png 1080w"><figcaption> The map </figcaption></figure>`;
    const img = document.querySelector("img")!;
    expect(describeImage(img)).toMatchObject({ alt: "Map", caption: "The map", src: expect.stringMatching(/\/a-1920\.png$/) });
  });

  it("opens on click and Enter for zoomable images only, and closes on Escape", async () => {
    await mount(`<figure><img data-zr-zoom="" tabindex="0" alt="Map" src="/a.png"><figcaption>The map</figcaption></figure><p>x <img alt="icon" src="/i.png"> y</p>`);
    const icon = container.querySelector('img[alt="icon"]') as HTMLImageElement;
    await act(async () => icon.click());
    expect(document.querySelector('[data-slot="image-viewer"]')).toBeNull();

    const map = container.querySelector('img[alt="Map"]') as HTMLImageElement;
    await act(async () => map.click());
    const dialog = document.querySelector('[data-slot="image-viewer"]')!;
    expect(dialog).not.toBeNull();
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.querySelector("img")!.getAttribute("alt")).toBe("Map");
    expect(dialog.textContent).toContain("The map");

    await act(async () => {
      dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(document.querySelector('[data-slot="image-viewer"]')).toBeNull();

    await act(async () => map.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(document.querySelector('[data-slot="image-viewer"]')).not.toBeNull();
  });
});

describe("book covers", () => {
  it("renders the cover through the provider's Image component", () => {
    const Image = ({ src }: { src: string }) => h("img", { src, "data-custom": "yes" });
    const html = renderToString(
      h(ReaderProvider, {
        books: [{ id: "b", title: "B", authors: [], cover: "/books/b/_assets/abcdef1234/cover.png", chapters: [{ id: "c", title: "C", order: 1 }] }],
        manageTheme: false,
        toaster: false,
        Image,
        children: h(BookShelf, { embedded: true }),
      }),
    );
    expect(html).toContain('src="/books/b/_assets/abcdef1234/cover.png"');
    expect(html).toContain('data-custom="yes"');
  });
});
