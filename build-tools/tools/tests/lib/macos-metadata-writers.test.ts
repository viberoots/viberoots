import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
}

test("direct buck-out tmp helper writers use macOS metadata exclusion helper", async () => {
  const root = repoRoot();
  const files = [
    "build-tools/tools/ci/buck-test-stage.ts",
    "build-tools/tools/ci/publish-nix-cache-manifest.ts",
    "build-tools/tools/ci/wheelhouse-preload.ts",
    "build-tools/tools/buck/exporter/go-simulated-cache.ts",
    "build-tools/tools/buck/exporter/golist.ts",
    "build-tools/tools/buck/exporter/main.ts",
    "build-tools/tools/dev/dev-build/housekeeping.ts",
    "build-tools/tools/dev/filtered-flake.ts",
    "build-tools/tools/dev/build-wasm-from-label.ts",
    "build-tools/tools/dev/install/link-node-helpers.ts",
    "build-tools/tools/dev/install/link-node.ts",
    "build-tools/tools/dev/nix-build-filtered-flake.ts",
    "build-tools/tools/dev/require-unified-pnpm-store.ts",
    "build-tools/tools/dev/run-runnable-graph.ts",
    "build-tools/tools/dev/run-runnable-nix.ts",
    "build-tools/tools/dev/sync-module-contracts-core.ts",
    "build-tools/tools/dev/update-pnpm-hash/exact-store.ts",
    "build-tools/tools/dev/update-pnpm-hash/exact-store-import.ts",
    "build-tools/tools/dev/update-pnpm-hash/filtered-flake.ts",
    "build-tools/tools/dev/update-pnpm-hash/prefetched-store.ts",
    "build-tools/tools/dev/update-pnpm-hash/verified-marker.ts",
    "build-tools/tools/dev/verify/buck-isolation-metadata.ts",
    "build-tools/tools/dev/verify/buck2-artifacts.ts",
    "build-tools/tools/dev/verify/nix-env.ts",
    "build-tools/tools/dev/verify/run-verify.ts",
    "build-tools/tools/dev/verify/safety-rails.ts",
    "build-tools/tools/dev/verify/seed-manifest.ts",
    "build-tools/tools/dev/verify/seed.ts",
    "build-tools/tools/dev/verify/tmp-root.ts",
    "build-tools/tools/dev/watch-wasm-coordinator.ts",
    "build-tools/tools/dev/wasm-watch-coordinator-daemon.ts",
    "build-tools/tools/dev/workspace-toolchains.ts",
  ];
  for (const rel of files) {
    const source = await fsp.readFile(path.join(root, rel), "utf8");
    assert.match(source, /mkdirWithMacosMetadataExclusion/, rel);
  }
});

test("sync remote verify artifact writer marks local artifact directories on Darwin", async () => {
  const source = await fsp.readFile(
    path.join(repoRoot(), "build-tools/tools/dev/verify/remote-buck-artifacts.ts"),
    "utf8",
  );
  assert.match(source, /process\.platform === "darwin"/);
  assert.match(source, /\.metadata_never_index/);
});
