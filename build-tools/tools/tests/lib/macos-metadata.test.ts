import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  MACOS_METADATA_NEVER_INDEX_FILE,
  emptyDirectoryPreservingMacosMetadataExclusion,
  markMacosMetadataNeverIndex,
  mkdirWithMacosMetadataExclusion,
  mkdtempNoindex,
} from "../../lib/macos-metadata";

test("macOS metadata helper marks generated roots on Darwin only", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "macos-metadata-"));
  try {
    const darwinDir = path.join(root, "darwin");
    await mkdirWithMacosMetadataExclusion(darwinDir, "darwin");
    const marker = await fsp.stat(path.join(darwinDir, MACOS_METADATA_NEVER_INDEX_FILE));
    assert.ok(marker.isFile());

    const linuxDir = path.join(root, "linux");
    await fsp.mkdir(linuxDir, { recursive: true });
    await markMacosMetadataNeverIndex(linuxDir, "linux");
    await assert.rejects(fsp.stat(path.join(linuxDir, MACOS_METADATA_NEVER_INDEX_FILE)));
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("macOS metadata helper can clear generated roots without removing marker", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "macos-metadata-clear-"));
  try {
    const dir = path.join(root, "test-logs");
    await fsp.mkdir(path.join(dir, "nested"), { recursive: true });
    await fsp.writeFile(path.join(dir, "nested", "log"), "nested", "utf8");
    await fsp.writeFile(path.join(dir, "old.log"), "old", "utf8");

    await emptyDirectoryPreservingMacosMetadataExclusion(dir, "darwin");

    const marker = await fsp.stat(path.join(dir, MACOS_METADATA_NEVER_INDEX_FILE));
    assert.ok(marker.isFile());
    await assert.rejects(fsp.stat(path.join(dir, "old.log")));
    await assert.rejects(fsp.stat(path.join(dir, "nested")));
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("macOS metadata helper does not rewrite an existing marker", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "macos-metadata-stable-"));
  try {
    const marker = path.join(root, MACOS_METADATA_NEVER_INDEX_FILE);
    await fsp.writeFile(marker, "keep", "utf8");

    await markMacosMetadataNeverIndex(root, "darwin");

    assert.equal(await fsp.readFile(marker, "utf8"), "keep");
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("mkdtempNoindex creates Darwin temp dirs under marked noindex parents", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "macos-metadata-mkdtemp-"));
  try {
    const dir = await mkdtempNoindex("child-", {
      baseName: "base",
      platform: "darwin",
      tmpBase: root,
    });

    assert.equal(path.dirname(dir), path.join(root, "base.noindex"));
    assert.match(path.basename(dir), /^child-/);
    assert.ok((await fsp.stat(dir)).isDirectory());
    assert.ok((await fsp.stat(path.join(root, "base.noindex"))).isDirectory());
    assert.ok(
      (await fsp.stat(path.join(root, "base.noindex", MACOS_METADATA_NEVER_INDEX_FILE))).isFile(),
    );
    assert.ok((await fsp.stat(path.join(dir, MACOS_METADATA_NEVER_INDEX_FILE))).isFile());
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("mkdtempNoindex leaves non-Darwin temp dirs in the requested base", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "macos-metadata-mkdtemp-linux-"));
  try {
    const dir = await mkdtempNoindex("child-", {
      baseName: "base",
      platform: "linux",
      tmpBase: root,
    });

    assert.equal(path.dirname(dir), root);
    assert.match(path.basename(dir), /^child-/);
    await assert.rejects(fsp.stat(path.join(root, "base.noindex")));
    await assert.rejects(fsp.stat(path.join(dir, MACOS_METADATA_NEVER_INDEX_FILE)));
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("verify coverage setup protects merged report directory from macOS metadata indexing", async () => {
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const coverageSource = await fsp.readFile(
    path.resolve(testDir, "../../dev/verify/coverage.ts"),
    "utf8",
  );
  assert.match(coverageSource, /mkdirWithMacosMetadataExclusion\(covDir\)/);
});

test("standalone coverage build marks report directories before writing coverage output", async () => {
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(testDir, "../../../..");
  const pkg = await fsp.readFile(path.join(root, "package.json"), "utf8");
  const coverageMarkDirsSource = await fsp.readFile(
    path.join(root, "build-tools/tools/dev/coverage-mark-dirs.ts"),
    "utf8",
  );

  assert.match(pkg, /coverage-mark-dirs\.ts/);
  assert.match(coverageMarkDirsSource, /mkdirWithMacosMetadataExclusion/);
});

test("agent safehouse and git CoW shell wrappers mark generated temp directories", async () => {
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(testDir, "../../../..");
  const files = [
    "build-tools/tools/bin/codex",
    "build-tools/tools/bin/claude",
    "build-tools/tools/bin/git",
  ];
  for (const rel of files) {
    const source = await fsp.readFile(path.join(root, rel), "utf8");
    assert.match(source, /mark_macos_metadata_never_index/, rel);
    assert.match(source, /\.metadata_never_index/, rel);
    assert.match(
      source,
      /\[\[ -e "\$\{dir\}\/\.metadata_never_index" \]\] \|\| : > "\$\{dir\}\/\.metadata_never_index"/,
      `${rel} must not rewrite existing metadata exclusion markers`,
    );
  }
  const gitSource = await fsp.readFile(path.join(root, "build-tools/tools/bin/git"), "utf8");
  assert.match(gitSource, /\.git-cow-stage\.noindex/);
});

test("Starlark shell snippets create macOS metadata markers only when absent", async () => {
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(testDir, "../../../..");
  const files = [
    "build-tools/cpp/private/nix_test.bzl",
    "build-tools/go/private/nix_build.bzl",
    "build-tools/go/private/nix_build_carchive.bzl",
    "build-tools/go/private/nix_build_wasm.bzl",
    "build-tools/go/private/nix_test.bzl",
    "build-tools/python/private/nix_build.bzl",
    "build-tools/python/private/nix_test.bzl",
    "build-tools/rust/private/nix_build.bzl",
    "build-tools/lang/nix_action_runner.bzl",
    "build-tools/lang/nix_cache_health.bzl",
    "build-tools/tools/buck/zx_test.bzl",
  ];
  for (const rel of files) {
    const source = await fsp.readFile(path.join(root, rel), "utf8");
    assert.doesNotMatch(
      source,
      /then : > \\"[^"\n]*\.metadata_never_index\\"/,
      `${rel} must not unconditionally truncate metadata exclusion markers`,
    );
    assert.match(
      source,
      /\[ ! -e \\"[^"\n]*\.metadata_never_index\\" \] && : > \\"[^"\n]*\.metadata_never_index\\"/,
      `${rel} must guard metadata exclusion marker creation`,
    );
  }
});

test("zx_test bootstrap marks generated toolchains directory on Darwin", async () => {
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(testDir, "../../../..");
  const source = await fsp.readFile(path.join(root, "build-tools/tools/buck/zx_test.bzl"), "utf8");
  assert.match(source, /WORKSPACE_ROOT\/toolchains\/\.metadata_never_index/);
});

test("build-selected Starlark log snippets mark their buck-out log directory", async () => {
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(testDir, "../../../..");
  const files = [
    "build-tools/cpp/private/nix_test.bzl",
    "build-tools/go/private/nix_build.bzl",
    "build-tools/go/private/nix_build_carchive.bzl",
    "build-tools/go/private/nix_build_wasm.bzl",
    "build-tools/go/private/nix_test.bzl",
    "build-tools/python/private/nix_build.bzl",
    "build-tools/python/private/nix_test.bzl",
    "build-tools/rust/private/nix_build.bzl",
  ];
  for (const rel of files) {
    const source = await fsp.readFile(path.join(root, rel), "utf8");
    const buildSelectedLogCount = source.match(/buck-out\/tmp\/build-selected/g)?.length ?? 0;
    const guardedMarkerCount =
      source.match(
        /\[ ! -e \\"\$BUILD_SELECTED_LOG_DIR\/\.metadata_never_index\\" \] && : > \\"\$BUILD_SELECTED_LOG_DIR\/\.metadata_never_index\\"/g,
      )?.length ?? 0;
    assert.equal(
      guardedMarkerCount,
      buildSelectedLogCount,
      `${rel} must mark each build-selected log dir`,
    );
  }
});

test("direct buck-out tmp helper writers use macOS metadata exclusion helper", async () => {
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(testDir, "../../../..");
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
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(testDir, "../../../..");
  const source = await fsp.readFile(
    path.join(root, "build-tools/tools/dev/verify/remote-buck-artifacts.ts"),
    "utf8",
  );
  assert.match(source, /process\.platform === "darwin"/);
  assert.match(source, /\.metadata_never_index/);
});
