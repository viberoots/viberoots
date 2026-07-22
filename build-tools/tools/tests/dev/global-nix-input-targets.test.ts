import assert from "node:assert/strict";
import fs from "fs-extra";
import path from "node:path";
import test from "node:test";
import { copyWorkspaceControlIntoSnapshot } from "../../dev/nix-build-filtered-flake-preparation";
import { renderGlobalNixInputTargets } from "../../lib/global-nix-input-targets";
import { runInScratchTemp } from "../lib/test-helpers";

const base = {
  hashesJson: Buffer.from("{}\n"),
  flakeNix: Buffer.from("flake\n"),
  flakeLock: Buffer.from("lock\n"),
  registryExtension: Buffer.from("registry\n"),
};

test("global Nix input TARGETS use stable labels and content-addressed outputs", () => {
  const first = renderGlobalNixInputTargets(base);
  const repeat = renderGlobalNixInputTargets(base);
  assert.deepEqual(repeat, first);
  assert.match(first.projectsConfigTargets, /name = "node-modules\.hashes\.json"/);
  assert.match(first.projectsConfigTargets, /out = "node-modules\.hashes\.[a-f0-9]{64}\.json"/);
  assert.match(first.workspaceTargets, /out = "flake\.[a-f0-9]{64}\.nix"/);
  assert.match(first.workspaceTargets, /out = "flake\.[a-f0-9]{64}\.lock"/);
  assert.match(
    first.workspaceTargets,
    /out = "nixpkgs-source-registry-extension\.[a-f0-9]{64}\.nix"/,
  );
  assert.doesNotMatch(first.projectsConfigTargets, /\/\/projects:/);
  assert.deepEqual(Object.keys(first.outputNames).sort(), [
    "root//.viberoots/workspace:flake.lock",
    "root//.viberoots/workspace:flake.nix",
    "root//.viberoots/workspace:nixpkgs-source-registry-extension",
    "root//projects/config:node-modules.hashes.json",
  ]);
});

test("filtered snapshots consume root-qualified synthetic global inputs", async () => {
  await runInScratchTemp("root-global-inputs", async (tmp) => {
    for (const [relative, contents] of [
      ["__global_nix_inputs__/root.viberoots-workspace-flake.nix", "flake"],
      ["__global_nix_inputs__/root.viberoots-workspace-flake.lock", "lock"],
      [
        "__global_nix_inputs__/root.viberoots-workspace-nixpkgs-source-registry-extension",
        "registry",
      ],
      ["__global_nix_inputs__/rootprojects-config-node-modules.hashes.json", "hashes"],
    ]) {
      await fs.outputFile(path.join(tmp, relative), `${contents}\n`);
    }
    const snapshot = path.join(tmp, "snapshot");
    await copyWorkspaceControlIntoSnapshot(tmp, snapshot);
    assert.equal(
      await fs.readFile(path.join(snapshot, ".viberoots/workspace/flake.nix"), "utf8"),
      "flake\n",
    );
    assert.equal(
      await fs.readFile(path.join(snapshot, "projects/config/node-modules.hashes.json"), "utf8"),
      "hashes\n",
    );
  });
});

test("filtered snapshots reject legacy basename global inputs", async () => {
  await runInScratchTemp("legacy-global-inputs", async (tmp) => {
    for (const relative of [
      "flake.nix",
      "flake.lock",
      "nixpkgs-source-registry-extension",
      "node-modules.hashes.json",
    ]) {
      await fs.outputFile(path.join(tmp, relative), `${relative}\n`);
    }
    await assert.rejects(
      copyWorkspaceControlIntoSnapshot(tmp, path.join(tmp, "snapshot")),
      /missing declared \.viberoots\/workspace\/flake\.nix/,
    );
  });
});

test("each mutable global export changes only its declared output identity", () => {
  const baseline = renderGlobalNixInputTargets(base).outputNames;
  for (const key of Object.keys(base) as Array<keyof typeof base>) {
    const changed = renderGlobalNixInputTargets({
      ...base,
      [key]: Buffer.from(`${key}-changed`),
    }).outputNames;
    const changedLabels = Object.keys(baseline).filter(
      (label) => baseline[label] !== changed[label],
    );
    assert.equal(changedLabels.length, 1, key);
  }
});
