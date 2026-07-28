import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { artifactNixExperimentalFeatureArgs } from "../../lib/artifact-nix-policy";
import { workspaceFlakeRef } from "../lib/test-helpers";

async function writeArtifact(root: string, addon: string, runtime: string): Promise<void> {
  await fs.mkdir(path.join(root, "lib/runtime"), { recursive: true });
  await fs.writeFile(path.join(root, `lib/${addon}.node`), "");
  await fs.writeFile(path.join(root, "lib/runtime/libcollision.dylib"), runtime);
}

async function stageScript(tmp: string, destination: string, artifacts: string[], $: any) {
  const flake = await workspaceFlakeRef(tmp);
  const helper = path.join(
    tmp,
    ".viberoots/current/build-tools/tools/nix/planner/node-native-addons.nix",
  );
  const addons = artifacts
    .map(
      (artifact, index) =>
        `{ name = "fixture-${index}"; addonName = "fixture_${index}"; artifact = builtins.toPath ${JSON.stringify(artifact)}; }`,
    )
    .join(" ");
  const expression = `let
    flake = builtins.getFlake ${JSON.stringify(`path:${flake}`)};
    lib = flake.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem}.lib;
    native = import ${JSON.stringify(helper)} {
      inherit lib; pkgs = flake.inputs.nixpkgs.legacyPackages.\${builtins.currentSystem};
      dependencyArtifactOf = _: null; depsOfName = _: []; nodeOfName = _: null;
      labelsOf = _: []; get = _: _: null;
    };
  in native.stage [ ${addons} ] ${JSON.stringify(destination)}`;
  const nix = path.join(String(process.env.VBR_ARTIFACT_TOOLS_ROOT), "bin/nix");
  const nixFeatures = artifactNixExperimentalFeatureArgs();
  return String(
    await $({
      cwd: tmp,
      stdio: "pipe",
    })`${nix} ${nixFeatures} eval --impure --raw --expr ${expression}`,
  );
}

export async function assertNativeAddonRuntimeCollisionBehavior(tmp: string, $: any) {
  const first = path.join(tmp, "runtime-collision/first");
  const second = path.join(tmp, "runtime-collision/second");
  await writeArtifact(first, "first", "same bytes\n");
  await writeArtifact(second, "second", "same bytes\n");
  const safeDestination = path.join(tmp, "runtime-collision/safe");
  const safeScript = await stageScript(tmp, safeDestination, [first, second], $);
  await $({ cwd: tmp, stdio: "pipe" })`bash -c ${safeScript}`;
  assert.equal(
    await fs.readFile(path.join(safeDestination, "runtime/libcollision.dylib"), "utf8"),
    "same bytes\n",
  );
  await fs.writeFile(path.join(second, "lib/runtime/libcollision.dylib"), "different bytes\n");
  const rejectedScript = await stageScript(
    tmp,
    path.join(tmp, "runtime-collision/rejected"),
    [first, second],
    $,
  );
  const rejected = await $({ cwd: tmp, stdio: "pipe", nothrow: true })`bash -c ${rejectedScript}`;
  assert.notEqual(rejected.exitCode, 0);
  assert.match(
    String(rejected.stderr || rejected.stdout),
    /runtime library collision.*libcollision/,
  );
}
