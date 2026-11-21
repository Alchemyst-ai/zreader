import { forwardRef, type AnchorHTMLAttributes, type ComponentType, type ReactNode } from "react";

/** Any router link with an `href` (e.g. next/link). */
export type LinkComponent = ComponentType<AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: ReactNode }>;

export const DefaultLink = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }>(
  function DefaultLink(props, ref) {
    return <a ref={ref} {...props} />;
  },
);

/** `${basePath}/${bookId}/${chapterId}#${hash}` */
export function defaultHref(basePath: string, bookId: string, chapterId?: string, hash?: string): string {
  const base = basePath.replace(/\/+$/, "");
  const path = chapterId ? `${base}/${encodeURIComponent(bookId)}/${encodeURIComponent(chapterId)}` : `${base}/${encodeURIComponent(bookId)}`;
  return hash ? `${path}#${encodeURIComponent(hash)}` : path;
}

/** Image component for covers and other UI images (e.g. next/image with `fill`). Fills a sized, `relative` box. */
export type ImageComponent = ComponentType<{ src: string; alt: string; className?: string; sizes?: string }>;

export function DefaultImage({ src, alt, className, sizes }: { src: string; alt: string; className?: string; sizes?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} sizes={sizes} loading="lazy" decoding="async" className={className} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />;
}
