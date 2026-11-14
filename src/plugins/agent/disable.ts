import type { AgentPlugin } from "./types";

/**
 * Drop a plugin inherited from the top-level `agent.plugins`.
 *
 *   bookshelves: [{ id: "reports", agent: { plugins: [disable("notFound")] } }]
 */
export function disable(name: string): AgentPlugin {
  return { name: `disable(${name})`, disable: name };
}
