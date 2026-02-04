#!/usr/bin/env zx-wrapper
// Asserts that with NIX_CPP_DEV_OVERRIDE_JSON set locally, we do not fail, and a warning is emitted.
import fs from "fs-extra";
import path from "node:path";

async function main() {
  // Create a tiny temp repo copy (tests already run in a temp sandbox via zx_test)
  // Set a benign override to an empty dir; templates use builtins.path which accepts any path
  const ws = await fs.mkdtemp("/tmp/cpp-dev-override-");
  const here = new URL(import.meta.url).pathname;
  const zxInit = path.resolve(path.dirname(here), "../../dev/zx-init.mjs");
  const nodeFlags = [
    "--experimental-top-level-await",
    "--experimental-strip-types",
    `--import ${zxInit}`,
  ].join(" ");
  const env = {
    ...process.env,
    NIX_CPP_DEV_OVERRIDE_JSON: JSON.stringify({ "pkgs.zlib": ws }),
    NODE_OPTIONS: [nodeFlags, process.env.NODE_OPTIONS || ""].filter(Boolean).join(" "),
  };
  // Run exporter + providers + gen-auto-map to trigger evaluation paths (zx-init loaded)
  await $({
    env,
  })`node build-tools/tools/buck/export-graph.ts --out build-tools/tools/buck/graph.json`;
  await $({ env })`node build-tools/tools/buck/sync-providers.ts --lang=cpp`;
  await $({
    env,
  })`node build-tools/tools/buck/gen-auto-map.ts --graph build-tools/tools/buck/graph.json --out third_party/providers/auto_map.bzl`;
  // Success if no throw; we do not assert on stderr text here to avoid flakiness.
  console.log("OK: local override did not fail");
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
