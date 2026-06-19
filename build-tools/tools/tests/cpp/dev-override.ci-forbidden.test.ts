#!/usr/bin/env zx-wrapper
// Asserts that with CI=true and NIX_CPP_DEV_OVERRIDE_JSON set, Nix eval fails.
async function main() {
  const env = {
    ...process.env,
    CI: "true",
    NIX_CPP_DEV_OVERRIDE_JSON: '{"pkgs.zlib":"/tmp/does-not-matter"}',
  };
  let failed = false;
  try {
    await $({
      env,
    })`node viberoots/build-tools/tools/buck/export-graph.ts --out .viberoots/workspace/buck/graph.json`;
    // Attempt a trivial build to force template evaluation
    await $({ env })`node viberoots/build-tools/tools/buck/sync-providers.ts --lang=cpp`;
    await $({
      env,
    })`node viberoots/build-tools/tools/buck/gen-auto-map.ts --graph .viberoots/workspace/buck/graph.json --out .viberoots/workspace/providers/auto_map.bzl`;
  } catch {
    failed = true;
  }
  if (!failed) {
    console.error("expected CI guard to fail but it passed");
    process.exit(2);
  }
  console.log("OK: CI guard failed as expected");
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
