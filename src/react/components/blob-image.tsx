import { useCallback, type ImgHTMLAttributes } from "react";
import { cn } from "cn";
import { ImageOffIcon } from "lucide-react";
import { BlobTooLargeError, blobUrl, dataUriToBlob } from "zreader";
import { useBlobStore, useBlobUrl, useReader } from "../context";

export type BlobImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & { src: string };

/** An `<img>` that also understands `zr-blob:<id>` (images readers added, from IndexedDB). */
export function BlobImage({ src, alt = "", className, ...props }: BlobImageProps) {
  const url = useBlobUrl(src);
  if (url === null) {
    return (
      <span role="img" aria-label={alt ? `${alt} (image not found in this browser)` : "Image not found in this browser"} className={cn("inline-flex items-center gap-1.5 rounded-md border border-dashed px-2 py-1 text-xs text-muted-foreground", className)}>
        <ImageOffIcon className="size-3.5" aria-hidden="true" /> {alt || "Missing image"}
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={alt} className={cn(url === undefined && "invisible", className)} {...props} />;
}

/**
 * Store an image a reader added and get its `zr-blob:` URL. Enforces
 * `userImages.enabled` and `userImages.maxBytes`; `data:` URIs are accepted too.
 */
export function useAddImage() {
  const blobs = useBlobStore();
  const { options } = useReader();
  const { enabled, maxBytes } = options.userImages;
  const add = useCallback(
    async (input: Blob | string): Promise<string> => {
      if (!enabled) throw new Error("Adding images is turned off");
      const blob = typeof input === "string" ? dataUriToBlob(input) : input;
      if (!blob || !blob.type.startsWith("image/")) throw new Error("Not an image");
      if (blob.size > maxBytes) throw new BlobTooLargeError(blob.size, maxBytes);
      return blobUrl(await blobs.put(blob));
    },
    [blobs, enabled, maxBytes],
  );
  return { add, enabled, maxBytes };
}

/** Image files in a paste or drop (`DataTransfer`). */
export function imageFiles(data: DataTransfer | null | undefined): File[] {
  if (!data) return [];
  return Array.from(data.files ?? []).filter((f) => f.type.startsWith("image/"));
}

const IMAGE_MD = /!\[([^\]]*)\]\((zr-blob:[a-z0-9_-]+)\)/gi;

/** `![alt](zr-blob:…)` references in a note, in order. */
export function noteImages(note: string): Array<{ alt: string; src: string }> {
  return Array.from(note.matchAll(IMAGE_MD), (m) => ({ alt: m[1] ?? "", src: m[2]! }));
}

/** A note with its image references replaced by `[image]`, for one-line previews. */
export function noteText(note: string): string {
  return note.replace(IMAGE_MD, (_m, alt: string) => (alt ? `[image: ${alt}]` : "[image]"));
}
