import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { runArtifactNix } from "../../ci/artifact-command";
import {
  canonicalArtifactToolsRoot,
  withoutArtifactEnvironmentInfluence,
} from "../../lib/artifact-environment";
import { artifactNixExperimentalFeatureArgs } from "../../lib/artifact-nix-policy";
import {
  materializeNixStorePaths,
  parseMaterializationManifest,
} from "../../remote-exec/nix-store-materialize";
import { buildCanonicalBundle, testTarget } from "./rust.source-selection.identity-fixture";

export async function assertPreparedRemoteMaterialization(options: {
  workspace: string;
  selectedBundleSource: string;
  immutableViberootsInputRoot: string;
  hostileWorkerEnv: NodeJS.ProcessEnv;
}): Promise<void> {
  const { workspace, selectedBundleSource, immutableViberootsInputRoot, hostileWorkerEnv } =
    options;
  const artifactToolsRoot = canonicalArtifactToolsRoot(workspace);
  const immutableFlakeRoot = path.join(selectedBundleSource, ".viberoots", "workspace");
  await fsp.access(path.join(immutableFlakeRoot, "flake.nix"));
  const preparedBundleBuild = await runArtifactNix({
    workspaceRoot: workspace,
    artifactToolsRoot,
    baseEnv: withoutArtifactEnvironmentInfluence(hostileWorkerEnv),
    args: [
      ...artifactNixExperimentalFeatureArgs(),
      "build",
      "--accept-flake-config",
      "--no-write-lock-file",
      `${immutableFlakeRoot}#graph-generator-selected`,
      "--no-link",
      "--print-out-paths",
    ],
  });
  const preparedBundlePath = String(preparedBundleBuild.stdout || "")
    .trim()
    .split(/\s+/)
    .at(-1);
  assert.match(String(preparedBundlePath), /^\/nix\/store\//);
  const remotePreparation = parseMaterializationManifest({
    schemaVersion: "viberoots.nix-store-materialization.v1",
    sourceRevision: "rust-pr2-identity-preparation",
    sourceSnapshot: immutableFlakeRoot,
    flakeLockFingerprint: "rust-pr2-locked-inputs",
    substituter: { trustedPublicKeys: [] },
    tools: { nix: artifactToolsRoot },
    storePaths: [
      {
        attr: "graph-generator-selected",
        path: preparedBundlePath!,
        expectedOutputIdentity: path.basename(preparedBundlePath!),
      },
    ],
  });
  const [prepared] = await materializeNixStorePaths({
    manifest: remotePreparation,
    artifactToolsRoot,
  });
  assert.ok(prepared);
  assert.equal(prepared.cache, "miss");
  assert.equal(prepared.command[0], path.join(artifactToolsRoot, "bin", "nix"));
  assert.ok(prepared.command.includes(`${immutableFlakeRoot}#graph-generator-selected`));
  assert.equal(prepared.path, preparedBundlePath);
  assert.equal(
    remotePreparation.storePaths[0]?.expectedOutputIdentity,
    path.basename(preparedBundlePath!),
  );
  assert.equal(remotePreparation.sourceSnapshot, immutableFlakeRoot);

  const selectedTest = await buildCanonicalBundle(
    workspace,
    "graph-generator-selected",
    immutableViberootsInputRoot,
    hostileWorkerEnv,
    testTarget,
  );
  const selectedTestReplay = await buildCanonicalBundle(
    workspace,
    "graph-generator-selected",
    immutableViberootsInputRoot,
    {
      ...hostileWorkerEnv,
      CARGO_HOME: path.join(workspace, "replayed-hostile-cargo-home"),
      RUSTFLAGS: "-C link-arg=/replayed/host-only",
    },
    testTarget,
  );
  assert.equal(
    selectedTestReplay.outPath,
    selectedTest.outPath,
    "prepared Rust test identity changed under hostile worker state",
  );
  const preparedExecution = await $({
    env: hostileWorkerEnv,
    stdio: "pipe",
  })`${path.join(selectedTest.outPath, "bin", "app-test")}`;
  assert.match(
    String(preparedExecution.stdout || "") + String(preparedExecution.stderr || ""),
    /test result: ok/,
  );
}
