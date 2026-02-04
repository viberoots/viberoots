import type { ScafFlags } from "./types.ts";
import { parseFlagMap } from "../../lib/cli.ts";

export function parseScafArgv(raw: string[]): { positionals: string[]; flags: ScafFlags } {
  const { positionals, flags } = parseFlagMap(raw);
  return { positionals, flags };
}
