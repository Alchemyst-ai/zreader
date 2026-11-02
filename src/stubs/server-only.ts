/**
 * Browser build of server-only entry points (`/content`, `/server`,
 * `/virtual-config`, `/user-config`). Importing them in client code is a bug:
 * pass `config.reader` to <ReaderProvider> instead.
 */
throw new Error(
  "zreader: this entry point is server-only and was imported from client code. " +
    "Use <ReaderRoot> (from zreader/server) or pass config.reader to <ReaderProvider>.",
);
export {};
