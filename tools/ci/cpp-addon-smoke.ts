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
    let artifactPath = "";
    try {
      const out = await $({
        stdio: "pipe",
      })`buck2 targets --show-output //libs/demo-native:napi_addon`;
      const line =
        String(out.stdout || "")
          .trim()
          .split(/\r?\n/)
          .filter(Boolean)
          .pop() || "";
      // Expect: //<target> <buck-out-path>
      const parts = line.split(/\s+/);
      artifactPath = parts.length >= 2 ? parts[parts.length - 1] : "";
      await $`buck2 targets --show-output //libs/demo-native:napi_addon`;
    } catch {}
    if (!artifactPath) {
      throw new Error("Unable to resolve addon artifact path via `buck2 targets --show-output`");
    }
    // Linkage sanity check: use otool -L on macOS, ldd on Linux
    if (process.platform === "darwin") {
      const out = await $({ stdio: "pipe" })`otool -L ${artifactPath}`;
      const txt = String(out.stdout || "").trim();
      if (!txt) {
        throw new Error("otool -L produced no output for addon artifact");
      }
    } else {
      const out = await $({ stdio: "pipe" })`ldd ${artifactPath}`;
      const txt = String(out.stdout || "").toLowerCase();
      if (!txt || /not a dynamic executable/.test(txt)) {
        throw new Error("ldd linkage check failed or artifact is not dynamically linked");
      }
    }

    // Run glue steps and Buck test for the scaffolded unit test
    await $`node tools/buck/export-graph.ts --out tools/buck/graph.json`;
    // Node providers sync (no-op if no pnpm lockfiles)
    await $`node tools/buck/sync-providers.ts --lang node`.nothrow();
    await $`node tools/buck/gen-auto-map.ts --graph tools/buck/graph.json --out third_party/providers/auto_map.bzl`;
    await $`node tools/buck/prebuild-guard.ts`;
    await $`buck2 test //libs/demo:unit`;
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
