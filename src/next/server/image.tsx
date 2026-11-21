/**
 * `next/image` for chapter images (server component). Chosen per image:
 *
 * - optimized: same-origin paths, and remote hosts listed in
 *   `content.images.allowRemote` (which `withReader` adds to `images.remotePatterns`);
 * - `unoptimized`: data URIs, SVG, local URLs with a query string, and remote
 *   hosts allowed by `allowRemote: true` (Next would refuse them);
 * - a plain `<img>`: images with an author `srcset`, and relative paths nothing resolved.
 *
 * Unknown sizes (remote images without `probeRemote`) use `width={0} height={0}`
 * with CSS sizing, so the page never crashes on them.
 */
import Image from "next/image";
import type { ImageOptions } from "zreader/config";
import { classifyImageUrl, hostAllowed } from "zreader/content";
import type { ZImageProps } from "zreader/react";

function num(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
}

export type ReaderImageDecision = "optimize" | "unoptimized" | "img";

export function imageDecision(src: string, hasSrcset: boolean, images: Pick<ImageOptions, "allowRemote">): ReaderImageDecision {
  if (hasSrcset) return "img";
  const kind = classifyImageUrl(src);
  if (kind === "relative" || kind === "other") return "img";
  if (kind === "data") return "unoptimized";
  const path = src.split(/[?#]/)[0]!;
  if (/\.svg$/i.test(path)) return "unoptimized";
  if (kind === "root") return src.includes("?") ? "unoptimized" : "optimize";
  // remote
  if (!Array.isArray(images.allowRemote)) return "unoptimized";
  try {
    const host = new URL(src.startsWith("//") ? `https:${src}` : src).hostname;
    return hostAllowed(host, images.allowRemote) ? "optimize" : "unoptimized";
  } catch {
    return "img";
  }
}

/** Builds the `img` component for one shelf's image options. */
export function createReaderImage(images: Pick<ImageOptions, "allowRemote">) {
  function ReaderImage({ src, alt = "", width, height, srcSet, sizes, loading, decoding: _decoding, style: _style, ...rest }: ZImageProps) {
    if (typeof src !== "string" || !src) return null;
    const decision = imageDecision(src, Boolean(srcSet), images);
    if (decision === "img") {
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={src} alt={alt} width={width} height={height} srcSet={srcSet} sizes={sizes} loading={loading ?? "lazy"} decoding="async" {...rest} />;
    }
    const url = src.startsWith("//") ? `https:${src}` : src;
    const w = num(width);
    const h = num(height);
    const unoptimized = decision === "unoptimized";
    if (w && h) {
      return (
        <Image
          src={url}
          alt={alt}
          width={w}
          height={h}
          sizes={sizes}
          loading={loading === "eager" ? "eager" : "lazy"}
          unoptimized={unoptimized}
          style={{ height: "auto" }}
          {...rest}
        />
      );
    }
    return (
      <Image
        src={url}
        alt={alt}
        width={0}
        height={0}
        sizes={sizes ?? "100vw"}
        loading={loading === "eager" ? "eager" : "lazy"}
        unoptimized={unoptimized}
        style={{ width: "auto", maxWidth: "100%", height: "auto" }}
        {...rest}
      />
    );
  }
  return ReaderImage;
}
