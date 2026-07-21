#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { makeFilteredFlakeRef } from "../../dev/filtered-flake";
import {
  buildCanonicalArtifactEnvironment,
  canonicalArtifactToolsRoot,
} from "../../lib/artifact-environment";
import { artifactNixPolicyArgs } from "../../lib/artifact-nix-policy";
import { resolveToolPathSync } from "../../lib/tool-paths";
import { workspaceFlakeRef } from "../lib/test-helpers";

test("verify test-seed uses immutable tool source and excludes generated Prelude", async () => {
  const workspaceFlakeRoot = await workspaceFlakeRef(process.cwd());
  const workspaceLock = JSON.parse(
    await fsp.readFile(path.join(workspaceFlakeRoot, "flake.lock"), "utf8"),
  ) as {
    nodes?: Record<
      string,
      { inputs?: { viberoots?: string }; locked?: { path?: string }; original?: { path?: string } }
    >;
    root?: string;
  };
  const viberootsNodeName = workspaceLock.nodes?.[workspaceLock.root || ""]?.inputs?.viberoots;
  const viberootsNode = viberootsNodeName ? workspaceLock.nodes?.[viberootsNodeName] : undefined;
  const immutableSource = String(viberootsNode?.locked?.path || "");
  assert.match(immutableSource, /^\/nix\/store\/[a-z0-9]{32}-source$/);
  assert.equal(viberootsNode?.original?.path, immutableSource);
  await fsp.access(path.join(immutableSource, "flake.nix"));

  const artifactToolsRoot = canonicalArtifactToolsRoot(
    process.cwd(),
    String(process.env.VBR_ARTIFACT_TOOLS_ROOT || ""),
  );
  const source = await makeFilteredFlakeRef({
    workspaceRoot: process.cwd(),
    attr: "test-seed",
    classification: "hermetic",
    logPrefix: "[verify-seed-test]",
    env: buildCanonicalArtifactEnvironment(process.cwd(), { artifactToolsRoot }),
    selectorEnv: {},
    immutableViberootsInputRoot: immutableSource,
  });
  const nixBin = resolveToolPathSync("nix", process.env);
  const args = [
    "build",
    ...artifactNixPolicyArgs(),
    source.flakeRef,
    "--accept-flake-config",
    "--no-link",
    "--print-out-paths",
  ];
  const out = await $({ stdio: "pipe" })`${nixBin} ${args}`.finally(source.cleanup);
  const seedPath = String(out.stdout || "")
    .trim()
    .split("\n")
    .filter(Boolean)
    .pop();
  assert.ok(seedPath, "expected nix build .#test-seed to output a store path");
  assert.match(seedPath, /^\/nix\/store\/[a-z0-9]{32}-test-seed$/);

  await assert.rejects(fsp.lstat(path.join(seedPath, ".viberoots", "current")), {
    code: "ENOENT",
  });

  const prelude = path.join(seedPath, "viberoots", "prelude");
  await assert.rejects(fsp.lstat(prelude), { code: "ENOENT" });

  const deploymentDefs = path.join(seedPath, "viberoots", "build-tools", "deployments", "defs.bzl");
  const deploymentDefsStat = await fsp.lstat(deploymentDefs);
  assert.ok(deploymentDefsStat.isFile(), "expected deployment defs in verify test-seed snapshot");

  const localViberootsFlake = path.join(seedPath, "viberoots", "flake.nix");
  const localViberootsFlakeStat = await fsp.lstat(localViberootsFlake);
  assert.ok(
    localViberootsFlakeStat.isFile(),
    "expected local viberoots flake input in verify test-seed snapshot",
  );
});
