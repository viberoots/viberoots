#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import { test } from "node:test";
import { makeFilteredFlakeRef } from "../../dev/filtered-flake";
import {
  buildCanonicalArtifactEnvironment,
  canonicalArtifactToolsRoot,
} from "../../lib/artifact-environment";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("flake exposes viberoots version metadata and mkWorkspace", async () => {
  const artifactToolsRoot = canonicalArtifactToolsRoot(
    process.cwd(),
    String(process.env.VBR_ARTIFACT_TOOLS_ROOT || ""),
  );
  const filtered = await makeFilteredFlakeRef({
    workspaceRoot: viberootsSourcePath("."),
    attr: "lib.version",
    logPrefix: "[flake-version-metadata]",
    env: buildCanonicalArtifactEnvironment(process.cwd(), { artifactToolsRoot }),
    selectorEnv: {},
  });
  const flakeRef = filtered.flakeRef.slice(0, filtered.flakeRef.lastIndexOf("#"));
  try {
    const version = await $({
      stdio: "pipe",
    })`nix eval --raw --accept-flake-config --impure ${`${flakeRef}#lib.version`}`;
    const releaseTag = await $({
      stdio: "pipe",
    })`nix eval --raw --accept-flake-config --impure ${`${flakeRef}#lib.releaseTag`}`;
    assert.equal(String(version.stdout || "").trim(), "0.0.0-dev");
    assert.equal(String(releaseTag.stdout || "").trim(), "v0.0.0-dev");

    const mkWorkspace = await $({
      stdio: "pipe",
    })`nix eval --no-write-lock-file --accept-flake-config --impure ${`${flakeRef}#lib.mkWorkspace`}`;
    assert.match(String(mkWorkspace.stdout || ""), /lambda mkWorkspace/);
  } finally {
    await filtered.cleanup();
  }
});

test("flake app wrappers use the viberoots source root for helper scripts", async () => {
  const apps = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/nix/flake/outputs-apps.nix"),
    "utf8",
  );
  const context = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/nix/flake/per-system-context.nix"),
    "utf8",
  );
  const bootstrapPackage = await fsp.readFile(
    viberootsSourcePath(
      "viberoots/build-tools/tools/nix/flake/packages/remote-worker-bootstrap.nix",
    ),
    "utf8",
  );
  const vercelPackage = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/nix/flake/packages/node-vercel-next.nix"),
    "utf8",
  );
  assert.match(context, /viberootsRootPath\s*=/);
  assert.match(
    context,
    /if builtins\.isAttrs viberootsInput then viberootsInput\.outPath else viberootsInput/,
  );
  assert.match(context, /viberootsRoot = viberootsRootPath/);
  assert.match(context, /builtins\.getEnv "WORKSPACE_ROOT"/);
  assert.match(context, /builtins\.getEnv "BUCK_TEST_SRC"/);
  assert.match(apps, /\{ pkgs, zx-wrapper, viberootsRoot, version, releaseTag, \.\.\. \}:/);
  assert.match(
    apps,
    /import \.\/packages\/remote-worker-bootstrap\.nix \{\s*inherit pkgs viberootsRoot;/,
  );
  assert.match(
    bootstrapPackage,
    /\$\{viberootsRoot\}\/build-tools\/tools\/remote-exec\/remote-worker-bootstrap\.ts/,
  );
  assert.match(apps, /\$\{viberootsRoot\}\/build-tools\/tools\/dev\/bulk-move\.ts/);
  assert.match(vercelPackage, /VIBEROOTS_SOURCE_ROOT="\$\{viberootsRoot\}"/);
  assert.match(
    vercelPackage,
    /\$VIBEROOTS_SOURCE_ROOT\/build-tools\/tools\/vercel\/next-artifact\.ts/,
  );
  assert.doesNotMatch(apps, /\$PWD\/build-tools\/tools\/remote-exec\/remote-worker-bootstrap\.ts/);
  assert.doesNotMatch(
    bootstrapPackage,
    /\$PWD\/build-tools\/tools\/remote-exec\/remote-worker-bootstrap\.ts/,
  );
  assert.doesNotMatch(apps, /\$PWD\/build-tools\/tools\/dev\/bulk-move\.ts/);
  assert.doesNotMatch(vercelPackage, /\$REPO_ROOT\/build-tools\/tools\/dev\/zx-init\.mjs/);
});
