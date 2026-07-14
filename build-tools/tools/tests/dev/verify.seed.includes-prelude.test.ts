#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { workspaceFlakeRef } from "../lib/test-helpers";

test("verify test-seed includes build-system paths needed by temp Buck repos", async () => {
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
  assert.equal(viberootsNode?.locked?.path, "./viberoots-flake-input");
  assert.equal(viberootsNode?.original?.path, "./viberoots-flake-input");

  const flakeRef = `path:${workspaceFlakeRoot}#test-seed`;
  const out = await $({
    stdio: "pipe",
  })`nix build --impure ${flakeRef} --accept-flake-config --no-link --print-out-paths`;
  const seedPath = String(out.stdout || "")
    .trim()
    .split("\n")
    .filter(Boolean)
    .pop();
  assert.ok(seedPath, "expected nix build .#test-seed to output a store path");
  assert.match(seedPath, /^\/nix\/store\/[a-z0-9]{32}-test-seed$/);

  const seedCurrent = await fsp.realpath(path.join(seedPath, ".viberoots", "current"));
  assert.match(
    seedCurrent,
    /^\/nix\/store\/[a-z0-9]{32}-(?:source|test-seed)(?:\/|$)/,
    `expected seed current to resolve to immutable store content, got ${seedCurrent}`,
  );
  const liveViberoots = await fsp.realpath(path.resolve("viberoots"));
  assert.notEqual(seedCurrent, liveViberoots, "seed current must not resolve to the live checkout");

  const prelude = path.join(seedPath, "viberoots", "prelude");
  const preludeStat = await fsp.lstat(prelude);
  assert.ok(
    preludeStat.isDirectory() || preludeStat.isSymbolicLink(),
    "expected prelude in verify test-seed snapshot",
  );

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
