#!/usr/bin/env zx-wrapper
import path from "node:path";
import { test } from "node:test";
import fs from "fs-extra";
import { runInTemp } from "../lib/test-helpers";

// Ensure dev env tooling when spawning Buck/Nix inside temp repos
process.env.TEST_NEED_DEV_ENV = "1";

test("node webapp: nix_node_test target passes when no tests present", async () => {
  await runInTemp("node-webapp-nix-node-test", async (tmp, _$) => {
    const $ = _$({ cwd: tmp, stdio: "pipe" });
    await $`git init`;
    // Scaffold with test target enabled
    await $`scaf new node webapp demo-web --yes`;

    // Proceed; environment is expected to provide Buck prelude via runInTemp setup

    // Keep devDependencies; update-pnpm-hash will align lockfile/FOD

    // Remove any sample tests so the runner passes with no matches
    await fs.remove(path.join(tmp, "apps", "demo-web", "test"));

    // Commit scaffold and lockfile so Nix flake sees importer under git+file sources
    await $`bash -lc 'git -C ${tmp} config user.email test@example.com && git -C ${tmp} config user.name test && git -C ${tmp} add -A && git -C ${tmp} commit -m scaffold'`.nothrow();

    // Update fixed-output hash for this importer
    await $({
      stdio: "inherit",
    })`NIX_PNPM_ALLOW_GENERATE=1 node tools/dev/update-pnpm-hash.ts --lockfile apps/demo-web/pnpm-lock.yaml`;

    // If lockfile wasn't written under the importer (workspace root wrote it), copy it and re-hash
    await $`bash -lc 'test -f pnpm-lock.yaml && [ ! -f apps/demo-web/pnpm-lock.yaml ] && cp pnpm-lock.yaml apps/demo-web/pnpm-lock.yaml || true'`;
    await $({
      stdio: "inherit",
    })`node tools/dev/update-pnpm-hash.ts --lockfile apps/demo-web/pnpm-lock.yaml`;

    // Ensure importer lockfile exists; if still missing, force-generate it locally and re-hash
    await $`bash -lc 'set -euo pipefail; if [ ! -f apps/demo-web/pnpm-lock.yaml ]; then mv -f pnpm-workspace.yaml pnpm-workspace.yaml.bak 2>/dev/null || true; echo "packages: \n  - ./" > apps/demo-web/pnpm-workspace.yaml; nix run nixpkgs#pnpm -- install --lockfile-only --prod=false --ignore-scripts --lockfile-dir ./apps/demo-web --dir ./apps/demo-web; rm -f apps/demo-web/pnpm-workspace.yaml; mv -f pnpm-workspace.yaml.bak pnpm-workspace.yaml 2>/dev/null || true; fi'`;
    await $({
      stdio: "inherit",
    })`node tools/dev/update-pnpm-hash.ts --lockfile apps/demo-web/pnpm-lock.yaml`;

    // Assert lockfile exists and dump importer directory for debugging
    await $`bash -lc 'set -e; echo "==== ls -la apps/demo-web ====\n"; ls -la apps/demo-web; test -f apps/demo-web/pnpm-lock.yaml'`;
    // Confirm Nix sees the importer lockfile path
    await $({
      stdio: "inherit",
    })`nix eval --impure --raw --expr 'builtins.toString (builtins.pathExists ./apps/demo-web/pnpm-lock.yaml)'`;

    // Warm pnpm-store/node-modules for this importer and restart buckd to pick updated digest
    await $({
      stdio: "inherit",
    })`nix build --impure --accept-flake-config .#pnpm-store.apps-demo-web`;
    await $({
      stdio: "inherit",
    })`nix build --impure --accept-flake-config .#node-modules.apps-demo-web`;
    // Reconcile any FOD digest drift detected during warm-up
    await $({
      stdio: "inherit",
    })`node tools/dev/update-pnpm-hash.ts --lockfile apps/demo-web/pnpm-lock.yaml`;
    await $({ stdio: "inherit" })`buck2 kill`.nothrow();

    // Append a nix_node_test target (unit) to the importer TARGETS
    await $`bash -lc 'cat >> apps/demo-web/TARGETS <<'\'EOF'\'

nix_node_test(
    name = "unit",
    lockfile_label = "lockfile:apps/demo-web/pnpm-lock.yaml#apps/demo-web",
)

EOF'`;

    // Glue and provider mapping (export graph → providers → auto_map)
    await $`node tools/buck/export-graph.ts --out tools/buck/graph.json`;
    await $`node tools/buck/sync-providers-node.ts`;
    await $`node tools/buck/gen-auto-map.ts --graph tools/buck/graph.json --out third_party/providers/auto_map.bzl`;

    // Target should exist and test should pass (no tests matched → success)
    await $({
      stdio: "inherit",
    })`buck2 targets --target-platforms prelude//platforms:default //apps/demo-web:unit`;
    await $({
      stdio: "inherit",
    })`buck2 test --target-platforms prelude//platforms:default //apps/demo-web:unit`;
  });
});
