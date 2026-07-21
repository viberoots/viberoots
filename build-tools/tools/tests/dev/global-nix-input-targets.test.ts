import assert from "node:assert/strict";
import test from "node:test";
import { renderGlobalNixInputTargets } from "../../lib/global-nix-input-targets";

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
