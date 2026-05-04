import type { ScafFlags } from "./types";
import { parseFlagMap } from "../../lib/cli";

export function parseScafArgv(raw: string[]): { positionals: string[]; flags: ScafFlags } {
  const { positionals, flags } = parseFlagMap(raw);
  return { positionals, flags };
}
