#!/usr/bin/env zx-wrapper
/**
 * tools/ci/cpp-addon-smoke.ts
 *
 * Cross-platform smoke build for the Node C++ addon scaffold.
 * - Creates a temp workspace (no changes to the live repo)
 * - Scaffolds `node cpp-addon` named "demo"
 * - Builds the native addon target: //libs/demo-native:napi_addon
 *
 * This is a build-only smoke check (no behavior change, no providers required).
 */
import path from "node:path";
import { runInTemp } from "../tests/lib/test-helpers.ts";

async function main() {
  // Minimize rsync size to speed up CI temp setup
  process.env.TEST_RSYNC_ROOTS =
    process.env.TEST_RSYNC_ROOTS || "tools toolchains cpp node lang prelude third_party/providers";

  await runInTemp("cpp-addon-smoke", async (_tmp, _$) => {
    const $ = _$({ stdio: "inherit" });
    // Initialize a git repo for any glue scripts that read git state
    await $`git init`;

    // Scaffold the addon pair: libs/demo and libs/demo-native
    await $`node tools/scaffolding/scaf.ts new node cpp-addon demo --yes`;

    // Build only the native addon via Buck (delegates to Nix template internally)
    await $`buck2 build //libs/demo-native:napi_addon`;

    // Optional: print target output for diagnostics
    try {
      await $`buck2 targets --show-output //libs/demo-native:napi_addon`;
    } catch {}
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
