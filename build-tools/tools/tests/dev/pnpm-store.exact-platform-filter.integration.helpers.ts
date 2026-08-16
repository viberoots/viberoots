import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { materializeFilteredViberootsSource } from "../../dev/filtered-flake-viberoots-input";
import {
  buildCanonicalArtifactEnvironment,
  canonicalArtifactToolsRoot,
} from "../../lib/artifact-environment";
import {
  defaultFilteredFlakeSnapshotRelPaths,
  defaultFilteredFlakeSnapshotRsyncSources,
  filteredFlakeRsyncExcludeArgs,
} from "../../dev/nix-build-filtered-flake-lib";
import { artifactNixExperimentalFeatureArgs } from "../../lib/artifact-nix-policy";
import { resolveToolPathSync } from "../../lib/tool-paths";

export const execFileAsync = promisify(execFile);
export const PRESSURE_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;
export const SHORT_COMMAND_TIMEOUT_MS = Math.max(120_000, Math.floor(PRESSURE_TIMEOUT_MS / 6));
export const MEDIUM_COMMAND_TIMEOUT_MS = Math.max(300_000, Math.floor(PRESSURE_TIMEOUT_MS / 3));
const sourceRoot = path.resolve(import.meta.dirname, "../../../..");
export const pnpmArgs = [
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

export async function timed<T>(label: string, operation: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    return await operation();
  } finally {
    console.log(`[timing] pnpm platform filter ${label}: ${Date.now() - started}ms`);
  }
}

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
    await timed(
      "source rsync",
      async () =>
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
          { cwd: sourceRoot, timeout: SHORT_COMMAND_TIMEOUT_MS },
        ),
    );
    const env = buildCanonicalArtifactEnvironment(process.cwd(), {
      artifactToolsRoot: canonicalArtifactToolsRoot(
        process.cwd(),
        String(process.env.VBR_ARTIFACT_TOOLS_ROOT || ""),
      ),
    });
    const inputRoot = (await materializeFilteredViberootsSource(filtered, env)).storePath;
    assert.match(inputRoot, /^\/nix\/store\/[a-z0-9]{32}-source$/);
    return inputRoot;
  } finally {
    await fsp.rm(fixture, { recursive: true, force: true });
  }
}

export async function productionConfig(): Promise<{ pnpm: string; universalMarkers: string[] }> {
  const isolationTaxonomy = await fsp.readFile(
    path.join(sourceRoot, "build-tools/tools/tests/isolated_test_conventions.bzl"),
    "utf8",
  );
  assert.match(
    isolationTaxonomy,
    /"build-tools\/tools\/tests\/dev\/pnpm-store\.exact-platform-filter\.integration\.test\.ts": True/,
  );
  const nix = resolveToolPathSync("nix");
  const nixFeatures = artifactNixExperimentalFeatureArgs();
  const inputRoot = await immutableProductionSource();
  const system = `${process.arch === "arm64" ? "aarch64" : "x86_64"}-${
    process.platform === "darwin" ? "darwin" : "linux"
  }`;
  const { stdout: pnpmStdout } = await timed(
    "pnpm app eval",
    async () =>
      await execFileAsync(
        nix,
        [
          ...nixFeatures,
          "eval",
          "--raw",
          "--no-write-lock-file",
          "--accept-flake-config",
          `path:${inputRoot}#apps.${system}.pnpm.program`,
        ],
        {
          timeout: SHORT_COMMAND_TIMEOUT_MS,
          maxBuffer: 4 * 1024 * 1024,
        },
      ),
  );
  const pnpm = pnpmStdout.trim();
  const derivationExpression = `
    let
      flake = builtins.getFlake ${JSON.stringify(`path:${inputRoot}`)};
      app = (builtins.getAttr ${JSON.stringify(system)} flake.apps).pnpm;
    in
      builtins.head (builtins.attrNames (builtins.getContext app.program))
  `;
  const { stdout: pnpmDrvStdout } = await timed(
    "pnpm derivation eval",
    async () =>
      await execFileAsync(
        nix,
        [...nixFeatures, "eval", "--raw", "--impure", "--expr", derivationExpression],
        { timeout: SHORT_COMMAND_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
      ),
  );
  const { stdout: pnpmOutStdout } = await timed(
    "pnpm output build",
    async () =>
      await execFileAsync(
        nix,
        [...nixFeatures, "build", "--no-link", "--print-out-paths", `${pnpmDrvStdout.trim()}^out`],
        { timeout: MEDIUM_COMMAND_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
      ),
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
  const { stdout } = await timed(
    "platform marker eval",
    async () =>
      await execFileAsync(
        nix,
        [...nixFeatures, "eval", "--impure", "--json", "--expr", expression],
        {
          timeout: SHORT_COMMAND_TIMEOUT_MS,
          maxBuffer: 4 * 1024 * 1024,
        },
      ),
  );
  const universalMarkers = JSON.parse(stdout) as string[];
  assert.match(pnpm, /^\/nix\/store\/[a-z0-9]{32}-pnpm-[0-9]+\.[0-9]+\.[0-9]+\/bin\/pnpm$/);
  assert.equal(universalMarkers.length, 3);
  return { pnpm, universalMarkers };
}
