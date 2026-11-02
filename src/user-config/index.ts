/**
 * Fallback for `zreader/user-config`.
 *
 * In Next.js, `withReader()` aliases this specifier straight to the project's
 * reader.config.ts (or to `zreader/empty-config`), so this file is
 * only used in plain Node: scripts, tests, other frameworks. It discovers
 * reader.config.* from `process.cwd()` and loads it with jiti.
 */
import type { ReaderUserConfig } from "../config/index";
import { findConfigFile, loadConfigFile } from "../config/load";

const file = findConfigFile(process.cwd());
const config: ReaderUserConfig = file ? await loadConfigFile(file) : {};

export const configFile: string | null = file;
export default config;
export type { ReaderUserConfig };
