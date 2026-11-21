import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "cn";
import { toast } from "sonner";
import { CheckCircle2Icon, CloudDownloadIcon, Loader2Icon, Trash2Icon } from "lucide-react";
import type { BookMeta } from "zreader";
import { Button } from "@/components/ui/button";
import { useHydrated, useLibrary, useReader } from "../context";

type Reply =
  | { type: "zr:progress"; done: number; total: number }
  | { type: "zr:saved"; saved: number; failed: number }
  | { type: "zr:removed"; removed: number }
  | { type: "zr:status"; saved: boolean; count: number; savedAt?: string };

export interface OfflineStatus {
  saved: boolean;
  count: number;
  savedAt?: string;
}

const registrations = new Map<string, Promise<ServiceWorkerRegistration>>();

function supported(): boolean {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator && typeof caches !== "undefined";
}

function register(script: string, scope: string) {
  const key = `${script}\0${scope}`;
  let p = registrations.get(key);
  if (!p) {
    p = navigator.serviceWorker.register(script, { scope }).then(async (reg) => {
      if (reg.active) return reg;
      const worker = reg.installing ?? reg.waiting;
      await new Promise<void>((resolve) => {
        if (!worker) return resolve();
        worker.addEventListener("statechange", () => worker.state === "activated" && resolve());
      });
      return reg;
    });
    registrations.set(key, p);
    p.catch(() => registrations.delete(key));
  }
  return p;
}

function ask(reg: ServiceWorkerRegistration, message: unknown, onReply: (r: Reply) => boolean | void): Promise<void> {
  return new Promise((resolve, reject) => {
    const worker = reg.active;
    if (!worker) return reject(new Error("The offline worker isn't active yet"));
    const channel = new MessageChannel();
    channel.port1.onmessage = (e) => {
      if (onReply(e.data as Reply) !== false) {
        channel.port1.close();
        resolve();
      }
    };
    worker.postMessage(message, [channel.port2]);
  });
}

/**
 * Save a book for offline reading (requires `reader.offline.enabled` and the
 * `zreader/sw` worker). Saves the book page and every chapter, with the files
 * they load.
 */
export function useOfflineBook(book: BookMeta) {
  const { options } = useReader();
  const library = useLibrary();
  // After hydration only: the server can't know whether service workers are supported.
  const hydrated = useHydrated();
  const enabled = hydrated && options.offline.enabled && supported();
  const scope = options.basePath.replace(/\/+$/, "") || "/";
  const key = `${scope}:${book.id}`;
  const [status, setStatus] = useState<OfflineStatus | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const live = useRef(true);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    const reg = await register(options.offline.serviceWorker, scope);
    await ask(reg, { type: "zr:status", key }, (r) => {
      if (r.type === "zr:status" && live.current) setStatus({ saved: r.saved, count: r.count, savedAt: r.savedAt });
    });
  }, [enabled, options.offline.serviceWorker, scope, key]);

  useEffect(() => {
    live.current = true;
    refresh().catch(() => {});
    return () => {
      live.current = false;
    };
  }, [refresh]);

  const save = useCallback(async () => {
    if (!enabled) return;
    const reg = await register(options.offline.serviceWorker, scope);
    const urls = [library.href(book.id), ...book.chapters.map((c) => library.href(book.id, c.id))];
    setProgress({ done: 0, total: urls.length });
    let result: { saved: number; failed: number } | null = null;
    await ask(reg, { type: "zr:save", key, urls }, (r) => {
      if (r.type === "zr:progress") {
        if (live.current) setProgress({ done: r.done, total: r.total });
        return false;
      }
      if (r.type === "zr:saved") result = r;
    });
    if (live.current) setProgress(null);
    await refresh();
    return result as { saved: number; failed: number } | null;
  }, [enabled, options.offline.serviceWorker, scope, key, library, book, refresh]);

  const remove = useCallback(async () => {
    if (!enabled) return;
    const reg = await register(options.offline.serviceWorker, scope);
    await ask(reg, { type: "zr:remove", key }, () => {});
    await refresh();
  }, [enabled, options.offline.serviceWorker, scope, key, refresh]);

  return { enabled, status, progress, save, remove };
}

/** "Save for offline" for a book's contents page. Renders nothing unless offline reading is enabled. */
export function SaveOffline({ book, className }: { book: BookMeta; className?: string }) {
  const offline = useOfflineBook(book);
  if (!offline.enabled) return null;
  if (offline.progress) {
    return (
      <Button type="button" variant="outline" size="sm" disabled className={className} aria-live="polite">
        <Loader2Icon className="animate-spin" /> Saving {offline.progress.done}/{offline.progress.total}
      </Button>
    );
  }
  if (offline.status?.saved) {
    return (
      <div className={cn("flex flex-wrap items-center gap-2 text-sm text-muted-foreground", className)}>
        <CheckCircle2Icon className="size-4" aria-hidden="true" /> Available offline
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => offline.remove().then(() => toast("Removed the offline copy"), (e: Error) => toast.error("Couldn't remove it", { description: e.message }))}
        >
          <Trash2Icon /> Remove
        </Button>
      </div>
    );
  }
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={className}
      onClick={() =>
        offline.save().then(
          (r) => (r && r.failed ? toast.warning(`Saved, but ${r.failed} file${r.failed === 1 ? "" : "s"} failed`) : toast.success("Saved for offline reading")),
          (e: Error) => toast.error("Couldn't save for offline", { description: e.message }),
        )
      }
    >
      <CloudDownloadIcon /> Save for offline
    </Button>
  );
}
