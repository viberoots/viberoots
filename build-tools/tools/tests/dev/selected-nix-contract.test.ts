#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { envWithResolvedNixBin } from "../../lib/tool-paths.ts";

async function readSource(rel: string): Promise<string> {
  return await fsp.readFile(`viberoots/${rel}`, "utf8");
}

test("bootstrap and submodule init export the selected nix binary", async () => {
  const bootstrap = await readSource("bootstrap");
  const init = await readSource("init");

  for (const [label, source] of [
    ["bootstrap", bootstrap],
    ["init", init],
  ] as const) {
    if (!source.includes("select_nix_bin()")) {
      throw new Error(`${label} must resolve a selected nix binary before running nix`);
    }
    if (!source.includes("/nix/var/nix/profiles/default/bin/nix")) {
      throw new Error(`${label} must prefer the host profile nix binary when available`);
    }
  }

  if (!bootstrap.includes("nix_cmd flake metadata") || !bootstrap.includes("nix_cmd run")) {
    throw new Error("bootstrap must use the selected nix command for flake metadata and nix run");
  }
  if (
    !bootstrap.includes("nix_cmd config show") ||
    !bootstrap.includes("nix_cmd profile install")
  ) {
    throw new Error(
      "bootstrap must use the selected nix command for config and profile operations",
    );
  }
  if (!init.includes('VBR_NIX_BIN="${nix_bin}"')) {
    throw new Error("submodule init must forward the selected nix binary into nix run");
  }
});

test("envWithResolvedNixBin exports an explicit selected nix binary", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "selected-nix-"));
  try {
    const nixBin = path.join(tmp, "nix");
    await fsp.writeFile(nixBin, "#!/bin/sh\nexit 0\n", "utf8");
    await fsp.chmod(nixBin, 0o755);

    const env = envWithResolvedNixBin({
      ...process.env,
      PATH: "",
      VBR_NIX_BIN: nixBin,
    });
    assert.equal(env.VBR_NIX_BIN, nixBin);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("install-time node module builders propagate selected nix to child processes", async () => {
  const depsMain = await readSource("build-tools/tools/dev/install/deps-main.ts");
  const linkNode = await readSource("build-tools/tools/dev/install/link-node.ts");
  const nodeModulesBuild = await readSource("build-tools/tools/dev/node-modules-build.ts");
  const runRunnable = await readSource("build-tools/tools/dev/run-runnable-nix.ts");
  const updateNix = await readSource("build-tools/tools/dev/update-pnpm-hash/nix.ts");
  const exactStore = await readSource("build-tools/tools/dev/update-pnpm-hash/exact-store.ts");
  const filteredFlake = await readSource(
    "build-tools/tools/dev/update-pnpm-hash/filtered-flake.ts",
  );
  const selectedFilteredFlake = await readSource("build-tools/tools/dev/filtered-flake.ts");
  const filteredFlakeInput = await readSource(
    "build-tools/tools/dev/filtered-flake-viberoots-input.ts",
  );
  const nixBuildFilteredFlake = await readSource(
    "build-tools/tools/dev/nix-build-filtered-flake.ts",
  );
  const importerLockfile = await readSource(
    "build-tools/tools/dev/update-pnpm-hash/importer-lockfile.ts",
  );
  const realizedStore = await readSource(
    "build-tools/tools/dev/update-pnpm-hash/realized-store.ts",
  );
  const consumerBootstrap = await readSource("build-tools/tools/lib/consumer-bootstrap.ts");
  const workspaceLockRepair = await readSource("build-tools/tools/lib/workspace-lock-repair.ts");
  const verifySeed = await readSource("build-tools/tools/dev/verify/seed.ts");
  const nixCacheHealth = await readSource("build-tools/tools/dev/verify/nix-cache-health.ts");
  const viberootsCli = await readSource("build-tools/tools/dev/viberoots.ts");
  const startupCheck = await readSource("build-tools/tools/dev/startup-check.ts");

  for (const [label, source] of [
    ["deps-main", depsMain],
    ["link-node", linkNode],
    ["node-modules-build", nodeModulesBuild],
    ["run-runnable-nix", runRunnable],
    ["update-pnpm-hash/nix", updateNix],
    ["update-pnpm-hash/exact-store", exactStore],
    ["filtered-flake-viberoots-input", filteredFlakeInput],
    ["nix-build-filtered-flake", nixBuildFilteredFlake],
    ["update-pnpm-hash/importer-lockfile", importerLockfile],
    ["update-pnpm-hash/realized-store", realizedStore],
    ["consumer-bootstrap", consumerBootstrap],
    ["workspace-lock-repair", workspaceLockRepair],
    ["verify/seed", verifySeed],
    ["verify/nix-cache-health", nixCacheHealth],
    ["viberoots-cli", viberootsCli],
    ["startup-check", startupCheck],
  ] as const) {
    if (!source.includes("envWithResolvedNixBin")) {
      throw new Error(`${label} must propagate VBR_NIX_BIN to child Nix processes`);
    }
  }

  for (const [label, source] of [
    ["update-pnpm-hash/nix", updateNix],
    ["update-pnpm-hash/exact-store", exactStore],
    ["update-pnpm-hash/importer-lockfile", importerLockfile],
    ["consumer-bootstrap", consumerBootstrap],
    ["workspace-lock-repair", workspaceLockRepair],
    ["verify/seed", verifySeed],
    ["verify/nix-cache-health", nixCacheHealth],
    ["viberoots-cli", viberootsCli],
    ["startup-check", startupCheck],
  ] as const) {
    if (!source.includes("withSanitizedInheritedNixConfig")) {
      throw new Error(`${label} must sanitize inherited NIX_CONFIG for child Nix processes`);
    }
  }
  for (const [label, source] of [
    ["update-pnpm-hash/nix", updateNix],
    ["update-pnpm-hash/exact-store", exactStore],
    ["update-pnpm-hash/filtered-flake", filteredFlake],
    ["filtered-flake", selectedFilteredFlake],
    ["nix-build-filtered-flake", nixBuildFilteredFlake],
    ["update-pnpm-hash/importer-lockfile", importerLockfile],
    ["update-pnpm-hash/realized-store", realizedStore],
    ["consumer-bootstrap", consumerBootstrap],
    ["workspace-lock-repair", workspaceLockRepair],
    ["verify/seed", verifySeed],
    ["verify/nix-cache-health", nixCacheHealth],
    ["viberoots-cli", viberootsCli],
    ["startup-check", startupCheck],
  ] as const) {
    if (source.includes('resolveToolPathSync("nix")')) {
      throw new Error(`${label} must resolve nix from the exact env passed to the child process`);
    }
  }
  if (!updateNix.includes('resolveToolPathSync("nix", commandEnv)')) {
    throw new Error("update-pnpm-hash/nix must resolve nix from the same env passed to nix");
  }
  if (!exactStore.includes('resolveToolPathSync("nix", nixEnv)')) {
    throw new Error("exact-store must resolve nix from the same env passed to nix");
  }
  if (!linkNode.includes('resolveToolPathSync("nix", buildEnv)')) {
    throw new Error("link-node must resolve nix from the same env passed to nix");
  }
  if (!startupCheck.includes('resolveToolPathSync("nix", nixEnv)')) {
    throw new Error("startup-check must resolve nix from the same env passed to nix");
  }
  if (!consumerBootstrap.includes('resolveToolPathSync("nix", nixEnv)')) {
    throw new Error("consumer-bootstrap must resolve nix from the same env passed to nix");
  }
  if (!workspaceLockRepair.includes('resolveToolPathSync("nix", nixEnv)')) {
    throw new Error("workspace-lock-repair must resolve nix from the same env passed to nix");
  }
  if (!verifySeed.includes('resolveToolPathSync("nix", seedEnv)')) {
    throw new Error("verify seed must resolve nix from the same env passed to nix");
  }
  if (!nixCacheHealth.includes('resolveToolPathSync("nix", nixEnv)')) {
    throw new Error("nix cache health must resolve nix from the same env passed to nix");
  }
  if (!viberootsCli.includes('resolveToolPathSync("nix", env)')) {
    throw new Error("viberoots develop must resolve nix from the same env passed to nix");
  }
  if (/execFileAsync\(\s*["']nix["']/.test(consumerBootstrap)) {
    throw new Error("consumer-bootstrap must not invoke ambient nix by command name");
  }
  if (filteredFlake.includes("process.env.NIX_BIN")) {
    throw new Error("filtered-flake must not let NIX_BIN bypass the selected VBR_NIX_BIN");
  }
  if (selectedFilteredFlake.includes("process.env.NIX_BIN")) {
    throw new Error("selected filtered-flake must not let NIX_BIN bypass VBR_NIX_BIN");
  }
  if (nixBuildFilteredFlake.includes("process.env.NIX_BIN")) {
    throw new Error("nix-build-filtered-flake must not let NIX_BIN bypass VBR_NIX_BIN");
  }
  if (!nodeModulesBuild.includes('"$NIX_BIN" build')) {
    throw new Error("node-modules-build timeout shell must invoke the selected nix binary");
  }
  if (!runRunnable.includes("spawn(nixBin")) {
    throw new Error("run-runnable-nix must spawn the resolved nix binary");
  }
  if (importerLockfile.includes("}`nix ${")) {
    throw new Error("importer-lockfile must invoke the selected nix binary");
  }
});
