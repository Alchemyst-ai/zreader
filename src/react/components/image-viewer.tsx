import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { cn } from "cn";
import { MinusIcon, PlusIcon, RotateCcwIcon, XIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";

/** What the viewer shows for one chapter image. */
export interface ViewerImage {
  src: string;
  alt: string;
  caption?: string;
  width?: number;
  height?: number;
}

/** Images the viewer opens: block images the content pipeline marked with `data-zr-zoom`. */
export const ZOOMABLE_SELECTOR = "img[data-zr-zoom]";

const MIN = 1;
const MAX = 5;

function largestCandidate(img: HTMLImageElement): string | null {
  const set = img.getAttribute("srcset");
  if (!set) return null;
  let best: { url: string; score: number } | null = null;
  // next/image srcsets have no commas inside URLs; data URIs never reach here.
  for (const part of set.split(/,\s+/)) {
    const [url, d = "1x"] = part.trim().split(/\s+/);
    if (!url) continue;
    const n = parseFloat(d);
    const score = d.endsWith("w") ? n : n * 10_000;
    if (!best || score > best.score) best = { url, score };
  }
  return best ? new URL(best.url, img.baseURI).href : null;
}

export function describeImage(img: HTMLImageElement): ViewerImage {
  const caption = img.closest("figure")?.querySelector("figcaption")?.textContent?.trim();
  return {
    src: largestCandidate(img) ?? (img.currentSrc || img.src),
    alt: img.alt,
    ...(caption ? { caption } : {}),
    ...(img.naturalWidth ? { width: img.naturalWidth, height: img.naturalHeight } : {}),
  };
}

/**
 * Opens the viewer on taps, clicks, Enter or Space on zoomable images inside
 * `root` (event delegation, so it works for server HTML and React content).
 */
export function useImageViewer(root: HTMLElement | null, enabled = true) {
  const [image, setImage] = useState<ViewerImage | null>(null);
  const trigger = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!root || !enabled) return;
    const pick = (t: EventTarget | null) => {
      const img = (t as Element | null)?.closest?.(ZOOMABLE_SELECTOR) as HTMLImageElement | null;
      return img && root.contains(img) ? img : null;
    };
    const open = (img: HTMLImageElement) => {
      trigger.current = img;
      setImage(describeImage(img));
    };
    const onClick = (e: MouseEvent) => {
      const img = pick(e.target);
      if (!img || e.defaultPrevented || e.button !== 0) return;
      if (img.ownerDocument.getSelection()?.toString()) return; // the reader is selecting text
      e.preventDefault();
      open(img);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const img = pick(e.target);
      if (!img) return;
      e.preventDefault();
      open(img);
    };
    root.addEventListener("click", onClick);
    root.addEventListener("keydown", onKey);
    return () => {
      root.removeEventListener("click", onClick);
      root.removeEventListener("keydown", onKey);
    };
  }, [root, enabled]);

  const close = useCallback(() => setImage(null), []);
  return { image, close, trigger };
}

export interface ImageViewerProps {
  image: ViewerImage | null;
  onClose: () => void;
  /** Gets focus back when the viewer closes. */
  returnFocus?: RefObject<HTMLElement | null>;
}

interface View {
  scale: number;
  x: number;
  y: number;
}

const RESET: View = { scale: 1, x: 0, y: 0 };

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

/** Full-screen image viewer: wheel, pinch or double-tap to zoom, drag to pan, swipe down or Esc to close. */
export function ImageViewer({ image, onClose, returnFocus }: ImageViewerProps) {
  const [view, setView] = useState<View>(RESET);
  const [dragging, setDragging] = useState(false);
  const stage = useRef<HTMLDivElement | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ start: View; dist?: number; mid?: { x: number; y: number }; origin?: { x: number; y: number }; swipe?: number } | null>(null);
  const lastTap = useRef(0);

  useEffect(() => {
    if (image) setView(RESET);
  }, [image]);

  /** Point relative to the stage centre. */
  const local = (clientX: number, clientY: number) => {
    const r = stage.current?.getBoundingClientRect();
    return r ? { x: clientX - (r.left + r.width / 2), y: clientY - (r.top + r.height / 2) } : { x: 0, y: 0 };
  };

  const zoomAt = useCallback((v: View, next: number, p: { x: number; y: number }): View => {
    const scale = clamp(next, MIN, MAX);
    if (scale === MIN) return RESET;
    const k = scale / v.scale;
    return { scale, x: p.x - (p.x - v.x) * k, y: p.y - (p.y - v.y) * k };
  }, []);

  const onWheel = (e: ReactWheelEvent) => {
    const p = local(e.clientX, e.clientY);
    setView((v) => zoomAt(v, v.scale * Math.exp(-e.deltaY * 0.002), p));
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    if (pts.length === 2) {
      const [a, b] = pts as [{ x: number; y: number }, { x: number; y: number }];
      gesture.current = { start: view, dist: Math.hypot(a.x - b.x, a.y - b.y), mid: local((a.x + b.x) / 2, (a.y + b.y) / 2) };
    } else if (pts.length === 1) {
      const now = Date.now();
      if (now - lastTap.current < 300) {
        const p = local(e.clientX, e.clientY);
        setView((v) => (v.scale > 1 ? RESET : zoomAt(v, 2.5, p)));
        lastTap.current = 0;
        gesture.current = null;
        return;
      }
      lastTap.current = now;
      gesture.current = { start: view, origin: { x: e.clientX, y: e.clientY }, swipe: 0 };
    }
    setDragging(true);
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    const pts = [...pointers.current.values()];
    if (pts.length >= 2 && g.dist && g.mid) {
      const [a, b] = pts as [{ x: number; y: number }, { x: number; y: number }];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      setView(zoomAt(g.start, g.start.scale * (dist / g.dist), g.mid));
    } else if (g.origin) {
      const dx = e.clientX - g.origin.x;
      const dy = e.clientY - g.origin.y;
      if (g.start.scale > 1) setView({ ...g.start, x: g.start.x + dx, y: g.start.y + dy });
      else {
        g.swipe = dy;
        setView({ scale: 1, x: 0, y: Math.max(0, dy) });
      }
    }
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (pointers.current.size === 0) {
      setDragging(false);
      if (g?.swipe != null && g.start.scale === 1) {
        if (g.swipe > 120) onClose();
        else setView(RESET);
      }
      gesture.current = null;
    }
  };

  const step = (factor: number) => setView((v) => zoomAt(v, v.scale * factor, { x: 0, y: 0 }));

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "+" || e.key === "=") step(1.5);
    else if (e.key === "-") step(1 / 1.5);
    else if (e.key === "0") setView(RESET);
    else return;
    e.preventDefault();
  };

  const button = "inline-flex size-10 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur hover:bg-black/70 focus-visible:outline-2 focus-visible:outline-white disabled:opacity-40 [&_svg]:size-5";

  return (
    <DialogPrimitive.Root open={image != null} onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          data-zr-viewer=""
          className="fixed inset-0 z-[60] bg-black/90 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none"
        />
        <DialogPrimitive.Content
          data-slot="image-viewer"
          className="fixed inset-0 z-[60] flex flex-col outline-none"
          onKeyDown={onKeyDown}
          onCloseAutoFocus={(e) => {
            if (returnFocus?.current) {
              e.preventDefault();
              returnFocus.current.focus({ preventScroll: true });
            }
          }}
        >
          <DialogPrimitive.Title className="sr-only">{image?.alt || "Image"}</DialogPrimitive.Title>
          {image?.caption ? (
            <DialogPrimitive.Description className="sr-only">{image.caption}</DialogPrimitive.Description>
          ) : (
            <DialogPrimitive.Description className="sr-only">Use + and - to zoom, 0 to reset, Escape to close.</DialogPrimitive.Description>
          )}
          <div className="absolute top-[max(0.75rem,env(safe-area-inset-top))] right-3 z-10 flex gap-2">
            <button type="button" className={button} onClick={() => step(1 / 1.5)} disabled={view.scale <= MIN} aria-label="Zoom out">
              <MinusIcon />
            </button>
            <button type="button" className={button} onClick={() => step(1.5)} disabled={view.scale >= MAX} aria-label="Zoom in">
              <PlusIcon />
            </button>
            <button type="button" className={button} onClick={() => setView(RESET)} disabled={view.scale === 1} aria-label="Reset zoom">
              <RotateCcwIcon />
            </button>
            <DialogPrimitive.Close className={button} aria-label="Close">
              <XIcon />
            </DialogPrimitive.Close>
          </div>
          <div
            ref={stage}
            className={cn("relative flex min-h-0 flex-1 touch-none items-center justify-center overflow-hidden select-none", view.scale > 1 ? (dragging ? "cursor-grabbing" : "cursor-grab") : "cursor-zoom-in")}
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onClick={(e) => {
              if (e.target === e.currentTarget && view.scale === 1) onClose();
            }}
          >
            {image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={image.src}
                alt={image.alt}
                draggable={false}
                className={cn("max-h-full max-w-full object-contain will-change-transform", !dragging && "transition-transform duration-150 motion-reduce:transition-none")}
                style={{ transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})` }}
              />
            )}
          </div>
          {image?.caption && (
            <p aria-hidden="true" className="mx-auto max-w-prose px-6 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] text-center text-sm text-white/80">
              {image.caption}
            </p>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
