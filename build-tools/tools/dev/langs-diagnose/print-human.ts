import fs from "node:fs";
import path from "node:path";
import type { DiagnoseOutput } from "./types";

function readPatchedCppProviderAttrs(): string[] {
  const autoMap = path.resolve("third_party/providers/auto_map.bzl");
  if (!fs.existsSync(autoMap)) return [];
  const txt = fs.readFileSync(autoMap, "utf8");
  const re = new RegExp('"//third_party/providers:nix_pkgs_([a-z0-9_]+)"', "gi");
  const set = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(txt))) set.add(m[1]);
  return Array.from(set).sort();
}

export function printHuman(out: DiagnoseOutput, filterId: string) {
  const sep = () => console.log("");

  console.log("Languages:");
  console.log("  enabled:", out.enabled.join(", ") || "(none)");
  if (out.disabled.length) {
    for (const d of out.disabled) {
      if (filterId && d.id !== filterId) continue;
      const miss = d.missingPaths.length ? ` (missing: ${d.missingPaths.join(", ")})` : "";
      console.log(`  disabled: ${d.id}${miss}`);
    }
  }

  sep();
  console.log("Exporter adapters:");
  console.log("  ", out.adapters.join(", ") || "(none)");

  sep();
  console.log("Planner plugins:");
  console.log("  ", out.plannerPlugins.join(", ") || "(none)");

  sep();
  console.log("CI stages (would run):");
  for (const s of out.stages) console.log("  -", s);

  if (Object.keys(out.patchInvalidation || {}).length) {
    sep();
    console.log("Patch invalidation strategy:");
    const ids = Object.keys(out.patchInvalidation).sort();
    for (const id of ids) {
      if (filterId && id !== filterId) continue;
      const s = out.patchInvalidation[id];
      if (!s) {
        console.log(`  ${id}: (unknown)`);
        continue;
      }
      console.log(
        `  ${id}: patchScope=${s.patchScope}, glueOnApplyRemove=${s.glueOnApplyRemove}, providerModel=${s.providerModel}`,
      );
    }
  }

  if (!filterId || filterId === "cpp") {
    try {
      const attrs = readPatchedCppProviderAttrs();
      if (attrs.length) {
        sep();
        console.log("Patched C++ nixpkgs providers detected:");
        console.log("  ", attrs.join(", "));
      }
    } catch {}
  }
}
