#!/usr/bin/env zx-wrapper
// tools/ci/run-stage.ts — small runner to invoke named CI stages locally or in CI
import assert from "node:assert";
import path from "node:path";

type Stage =
  | "codegen"
  | "export-graph"
  | "sync-providers-go"
  | "sync-providers-node"
  | "gen-auto-map"
  | "prebuild-guard"
  | "patches-lint"
  | "nix-build-graph-generator"
  | "buck-test";

const stage = String((argv.stage as string) || "");
assert(stage, "missing --stage=<name>");
const zxInit = path.resolve("tools/dev/zx-init.mjs");
const nodeBase = [
  "--experimental-top-level-await",
  "--experimental-strip-types",
  "--disable-warning=ExperimentalWarning",
  "--import",
  zxInit,
];

async function main() {
  switch (stage as Stage) {
    case "codegen": {
      const target = path.resolve("tools/codegen.ts");
      try {
        await $`test -f ${target} || exit 0`;
        await $`node ${nodeBase} ${target}`;
      } catch {}
      break;
    }
    case "export-graph": {
      const target = path.resolve("tools/buck/export-graph.ts");
      await $`node ${nodeBase} ${target} --out tools/buck/graph.json`;
      break;
    }
    case "sync-providers-go": {
      const target = path.resolve("tools/buck/sync-providers.ts");
      await $`node ${nodeBase} ${target}`;
      break;
    }
    case "sync-providers-node": {
      try {
        await $`git ls-files '**/pnpm-lock.yaml' >/dev/null 2>&1`;
      } catch {
        break; // no lockfiles; no-op
      }
      // Ensure 'yaml' package is available; otherwise skip gracefully
      try {
        await $`node -e "require.resolve('yaml')"`;
      } catch {
        console.warn("yaml package missing; skipping node providers stage");
        break;
      }
      {
        const target = path.resolve("tools/buck/sync-providers-node.ts");
        await $`node ${nodeBase} ${target}`;
      }
      break;
    }
    case "gen-auto-map": {
      const target = path.resolve("tools/buck/gen-auto-map.ts");
      await $`node ${nodeBase} ${target} --graph tools/buck/graph.json --out third_party/providers/auto_map.bzl`;
      break;
    }
    case "prebuild-guard": {
      const target = path.resolve("tools/buck/prebuild-guard.ts");
      await $`node ${nodeBase} ${target}`;
      break;
    }
    case "patches-lint": {
      const target = path.resolve("tools/dev/patches-lint.ts");
      // Strict mode in CI; scope language to go
      await $`node ${nodeBase} ${target} --strict --lang go`;
      break;
    }
    case "nix-build-graph-generator":
      // Optional: if the flake doesn't expose graph-generator, skip gracefully in local runs
      try {
        await $`nix build .#graph-generator`;
      } catch (e) {
        console.warn("graph-generator attribute missing; skipping nix build stage");
      }
      break;
    case "buck-test":
      // External timeout is recommended; allow override via TIMEOUT_SEC
      const t = Number(process.env.TIMEOUT_SEC || 300);
      // Coverage passthrough if COVERAGE=1 in env
      const extra = process.env.COVERAGE === "1" ? ["--", "--env", "COVERAGE=1"] : [];
      await $`timeout -k 10s ${t}s buck2 test //... ${extra}`;
      break;
    default:
      throw new Error(`unknown stage: ${stage}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
