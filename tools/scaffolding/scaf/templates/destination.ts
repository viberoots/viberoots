import * as fs from "node:fs";
import path from "node:path";

export function resolveDestination(
  language: string,
  template: string,
  name: string,
  override?: string,
): { path: string; needsConfirm: boolean } {
  if (override) {
    return { path: override, needsConfirm: false };
  }
  const cfgPath = path.join("tools", "scaffolding", "resolver.json");
  try {
    const raw = fs.readFileSync(cfgPath, "utf8");
    const cfg = JSON.parse(raw || "{}");
    const langCfg = (cfg && typeof cfg === "object" ? cfg[language] : undefined) || {};
    let pattern = (langCfg && typeof langCfg === "object" ? langCfg[template] : undefined) as
      | string
      | undefined;
    if (!pattern) {
      const def = (cfg && typeof cfg === "object" ? cfg["default"] : undefined) || {};
      pattern = (def && typeof def === "object" ? def[template] : undefined) as string | undefined;
    }
    if (pattern && typeof pattern === "string") {
      return { path: pattern.replaceAll("{name}", name), needsConfirm: false };
    }
  } catch {}
  return { path: path.join(".", name), needsConfirm: true };
}
