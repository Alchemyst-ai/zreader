import { serviceWorkerRoute } from "zreader/next/server";

// The offline-reading service worker (reader.offline.enabled in reader.config.ts).
export const { GET } = serviceWorkerRoute();
export const dynamic = "force-static";
