#!/usr/bin/env zx-wrapper
// tools/ci/run-stage.ts — small runner to invoke named CI stages locally or in CI
import assert from "node:assert";

type Stage =
  | "codegen"
  | "export-graph"
  | "sync-providers-go"
  | "sync-providers-node"
  | "gen-auto-map"
  | "prebuild-guard"
  | "nix-build-graph-generator"
  | "buck-test";

const stage = String((argv.stage as string) || "");
assert(stage, "missing --stage=<name>");

async function main() {
  switch (stage as Stage) {
    case "codegen":
      await $`node tools/codegen.ts || true`;
      break;
    case "export-graph":
      await $`node tools/buck/export-graph.ts --out tools/buck/graph.json`;
      break;
    case "sync-providers-go":
      await $`node tools/buck/sync-providers.ts`;
      break;
    case "sync-providers-node":
      try {
        await $`git ls-files '**/pnpm-lock.yaml' >/dev/null 2>&1`;
        await $`node tools/buck/sync-providers-node.ts`;
      } catch {
        // no lockfiles; no-op
      }
      break;
    case "gen-auto-map":
      await $`node tools/buck/gen-auto-map.ts --graph tools/buck/graph.json --out third_party/providers/auto_map.bzl`;
      break;
    case "prebuild-guard":
      await $`node tools/buck/prebuild-guard.ts`;
      break;
    case "nix-build-graph-generator":
      await $`nix build .#graph-generator`;
      break;
    case "buck-test":
      // External timeout is recommended; allow override via TIMEOUT_SEC
      const t = Number(process.env.TIMEOUT_SEC || 180);
      await $`timeout -k 10s ${t}s buck2 test //...`;
      break;
    default:
      throw new Error(`unknown stage: ${stage}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
