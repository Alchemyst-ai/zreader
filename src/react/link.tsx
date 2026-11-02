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
