import type { ScafFlags } from "./types.ts";

export function parseScafArgv(raw: string[]): { positionals: string[]; flags: ScafFlags } {
  const positionals: string[] = [];
  const flags: ScafFlags = {};

  for (let i = 0; i < raw.length; i++) {
    const a = raw[i] || "";
    if (!a.startsWith("--")) {
      positionals.push(a);
      continue;
    }

    const eq = a.indexOf("=");
    if (eq >= 0) {
      const key = a.slice(2, eq);
      const value = a.slice(eq + 1);
      if (key) flags[key] = value;
      continue;
    }

    const key = a.slice(2);
    if (!key) continue;
    flags[key] = "true";
  }

  return { positionals, flags };
}
