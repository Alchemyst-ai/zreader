/**
 * `zreader/next/client` — <ReaderProvider> pre-wired to next/link and
 * next/image (optional Next.js adapter).
 *
 * Exists because a Server Component can't pass the `Link` function to a client
 * provider; binding it here, in a client module, removes that boilerplate.
 */
import Image from "next/image";
import Link from "next/link";
import { ReaderProvider, type ImageComponent, type LinkComponent, type ReaderProviderProps } from "zreader/react";

export type NextReaderProviderProps = Omit<ReaderProviderProps, "Link" | "Image">;

/** Covers through next/image (`fill`). Data URIs, SVG, query strings and remote URLs are not optimized. */
export const NextCoverImage: ImageComponent = ({ src, alt, className, sizes }) => {
  const local = src.startsWith("/") && !src.startsWith("//") && !src.includes("?") && !/\.svg$/i.test(src);
  return <Image src={src} alt={alt} fill sizes={sizes ?? "160px"} unoptimized={!local} className={className} style={{ objectFit: "cover" }} />;
};

export function NextReaderProvider(props: NextReaderProviderProps) {
  return <ReaderProvider {...props} Link={Link as unknown as LinkComponent} Image={NextCoverImage} />;
}
