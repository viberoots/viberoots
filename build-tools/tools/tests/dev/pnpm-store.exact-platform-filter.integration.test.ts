#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { externalNodeToolEnv } from "../../lib/external-node-env";
import { test } from "node:test";
import { promisify } from "node:util";
import { materializeFilteredViberootsSource } from "../../dev/filtered-flake-viberoots-input";
import {
  defaultFilteredFlakeSnapshotRelPaths,
  defaultFilteredFlakeSnapshotRsyncSources,
  filteredFlakeRsyncExcludeArgs,
} from "../../dev/nix-build-filtered-flake-lib";
import { resolveToolPathSync } from "../../lib/tool-paths";

const execFileAsync = promisify(execFile);
const sourceRoot = path.resolve(import.meta.dirname, "../../../..");
const pnpmArgs = [
  "--frozen-lockfile",
  "--ignore-scripts",
  "--ignore-pnpmfile",
  "--prefer-offline",
  "--network-concurrency",
  "1",
  "--child-concurrency",
  "1",
  "--prod=false",
  "--lockfile-dir",
  ".",
  "--dir",
  ".",
  "--store-dir",
  "store",
  "--modules-dir",
  "modules",
  "--virtual-store-dir",
  "modules/.pnpm",
  "--package-import-method",
  "hardlink",
  "--reporter=append-only",
  "--color",
  "never",
];

async function immutableProductionSource(): Promise<string> {
  const fixture = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-pnpm-platform-source-"));
  const filtered = path.join(fixture, "source");
  try {
    const relPaths: string[] = [];
    for (const rel of defaultFilteredFlakeSnapshotRelPaths()) {
      if (
        await fsp.access(path.join(sourceRoot, rel)).then(
          () => true,
          () => false,
        )
      ) {
        relPaths.push(rel);
      }
    }
    await fsp.mkdir(filtered);
    await execFileAsync(
      resolveToolPathSync("rsync"),
      [
        "-a",
        "--delete",
        "--relative",
        ...filteredFlakeRsyncExcludeArgs(),
        ...defaultFilteredFlakeSnapshotRsyncSources(relPaths),
        `${filtered}/`,
      ],
      { cwd: sourceRoot, timeout: 30_000 },
    );
    const inputRoot = (await materializeFilteredViberootsSource(filtered)).storePath;
    assert.match(inputRoot, /^\/nix\/store\/[a-z0-9]{32}-source$/);
    return inputRoot;
  } finally {
    await fsp.rm(fixture, { recursive: true, force: true });
  }
}

async function productionConfig(): Promise<{ pnpm: string; universalMarkers: string[] }> {
  const isolationTaxonomy = await fsp.readFile(
    path.join(sourceRoot, "build-tools/tools/tests/isolated_test_conventions.bzl"),
    "utf8",
  );
  assert.match(
    isolationTaxonomy,
    /"build-tools\/tools\/tests\/dev\/pnpm-store\.exact-platform-filter\.integration\.test\.ts": True/,
  );
  const nix = resolveToolPathSync("nix");
  const inputRoot = await immutableProductionSource();
  const system = `${process.arch === "arm64" ? "aarch64" : "x86_64"}-${
    process.platform === "darwin" ? "darwin" : "linux"
  }`;
  const { stdout: pnpmStdout } = await execFileAsync(
    nix,
    [
      "eval",
      "--raw",
      "--no-write-lock-file",
      "--accept-flake-config",
      `path:${inputRoot}#apps.${system}.pnpm.program`,
    ],
    {
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  const pnpm = pnpmStdout.trim();
  const derivationExpression = `
    let
      flake = builtins.getFlake ${JSON.stringify(`path:${inputRoot}`)};
      app = (builtins.getAttr ${JSON.stringify(system)} flake.apps).pnpm;
    in
      builtins.head (builtins.attrNames (builtins.getContext app.program))
  `;
  const { stdout: pnpmDrvStdout } = await execFileAsync(
    nix,
    ["eval", "--raw", "--impure", "--expr", derivationExpression],
    { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
  );
  const { stdout: pnpmOutStdout } = await execFileAsync(
    nix,
    ["build", "--no-link", "--print-out-paths", `${pnpmDrvStdout.trim()}^out`],
    { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 },
  );
  assert.equal(path.dirname(path.dirname(pnpm)), pnpmOutStdout.trim());
  await fsp.access(pnpm, fs.constants.X_OK);
  const platformsNix = path.join(
    inputRoot,
    "build-tools/tools/nix/node-modules/supported-platforms.nix",
  );
  const expression = `
    (import (builtins.toPath ${JSON.stringify(platformsNix)}) { }).universalMarkers
  `;
  const { stdout } = await execFileAsync(
    nix,
    ["eval", "--impure", "--json", "--expr", expression],
    {
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  const universalMarkers = JSON.parse(stdout) as string[];
  assert.match(pnpm, /^\/nix\/store\/[a-z0-9]{32}-pnpm-[0-9]+\.[0-9]+\.[0-9]+\/bin\/pnpm$/);
  assert.equal(universalMarkers.length, 3);
  return { pnpm, universalMarkers };
}

test(
  "pnpm store fetch retains supported Nix os/cpu tuples with the deterministic Linux libc union",
  { timeout: 180_000 },
  async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-pnpm-platform-filter-"));
    const { pnpm, universalMarkers } = await productionConfig();
    const env = { ...externalNodeToolEnv(), CI: "1", FORCE_COLOR: "0", NO_COLOR: "1" };
    try {
      await fsp.writeFile(
        path.join(root, "package.json"),
        JSON.stringify({
          name: "pnpm-platform-filter-proof",
          private: true,
          dependencies: { esbuild: "0.25.9", sharp: "0.33.5" },
        }) + "\n",
      );
      await execFileAsync(
        pnpm,
        [
          "install",
          "--lockfile-only",
          "--ignore-scripts",
          "--ignore-pnpmfile",
          "--ignore-workspace",
          "--dir",
          ".",
        ],
        { cwd: root, env, timeout: 30_000 },
      );

      for (const marker of universalMarkers) {
        await fsp.writeFile(
          path.join(root, "pnpm-workspace.yaml"),
          ["packages:", "  - ./", marker].join("\n"),
        );
        await execFileAsync(pnpm, ["fetch", ...pnpmArgs], {
          cwd: root,
          env,
          timeout: 30_000,
          maxBuffer: 4 * 1024 * 1024,
        });
      }

      const index = (await fsp.readFile(path.join(root, "store", "v11", "index.db"))).toString(
        "latin1",
      );
      for (const expected of [
        "@esbuild/darwin-arm64@0.25.9",
        "@esbuild/linux-arm64@0.25.9",
        "@esbuild/linux-x64@0.25.9",
        "@img/sharp-linux-arm64@0.33.5",
        "@img/sharp-linux-x64@0.33.5",
        "@img/sharp-linuxmusl-arm64@0.33.5",
        "@img/sharp-linuxmusl-x64@0.33.5",
      ]) {
        assert.match(index, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      }
      for (const foreign of [
        "@esbuild/darwin-x64@0.25.9",
        "@esbuild/linux-arm@0.25.9",
        "@esbuild/win32-x64@0.25.9",
      ]) {
        assert.doesNotMatch(index, new RegExp(foreign.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      }

      const storeSource = await fsp.readFile(
        path.resolve(import.meta.dirname, "../../nix/node-modules/store.nix"),
        "utf8",
      );
      assert.doesNotMatch(storeSource, /\$PNPM_BIN" fetch \\\n\s+--force/);
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  },
);
