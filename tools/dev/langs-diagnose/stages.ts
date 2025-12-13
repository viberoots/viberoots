import type { Capabilities } from "./types";
import { findPnpmLockfiles } from "../../lib/lockfiles.ts";

export async function computeStages(
  enabled: string[],
  caps: Map<string, Capabilities>,
  filterId: string,
): Promise<string[]> {
  const stages: string[] = [];
  const has = (id: string) => enabled.includes(id);
  const cap = (id: string, k: string) => Boolean((caps.get(id) || ({} as any))[k]);

  if ((!filterId && has("go")) || (filterId === "go" && has("go"))) {
    if (
      caps.size === 0 ||
      cap("go", "patching") ||
      !(caps.get("go") && caps.get("go")!.patching === false)
    ) {
      stages.push("sync-providers-go");
    }
  }

  const nodeEligible =
    ((!filterId && has("node")) || (filterId === "node" && has("node"))) &&
    (caps.size === 0 ||
      cap("node", "patching") ||
      !(caps.get("node") && caps.get("node")!.patching === false));
  if (nodeEligible) {
    const locks = await findPnpmLockfiles();
    if (locks.length > 0) stages.push("sync-providers-node");
  }

  stages.push("export-graph", "gen-auto-map", "prebuild-guard", "buck-test");
  return stages;
}
