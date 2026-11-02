/**
 * `zreader/virtual-config` — the fully resolved, validated config.
 *
 * `zreader/user-config` is resolved by the *app's* bundler, which
 * `withReader()` points at the project's reader.config.ts. Server-only.
 */
import userConfig from "zreader/user-config";
import { resolveConfig, type ResolvedReaderConfig } from "zreader/config";

const config: ResolvedReaderConfig = resolveConfig(userConfig, null, { source: "reader.config" });

export default config;
export type { ResolvedReaderConfig };
