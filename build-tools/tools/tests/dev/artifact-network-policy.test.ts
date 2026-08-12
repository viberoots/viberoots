#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  artifactNixIndependentPolicyArgs,
  artifactNixPolicyArgs,
  REVIEWED_OPTIONAL_SUBSTITUTERS,
  REVIEWED_REQUIRED_SUBSTITUTERS,
  reviewedArtifactSandboxPaths,
} from "../../lib/artifact-nix-policy";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";
import { assertArtifactNetworkPolicyInventory } from "./artifact-network-policy.contract";

function read(rel: string): string {
  return fs.readFileSync(viberootsSourcePath(rel), "utf8");
}

function productionFiles(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "tests" || entry.name === "docs") return [];
      return productionFiles(file);
    }
    return /\.(?:bzl|sh|ts)$/u.test(entry.name) ? [file] : [];
  });
}

test("policy command fixes sandbox, builders, and keys without rebuilding cache policy", () => {
  const args = artifactNixPolicyArgs();
  assert.equal(args[args.indexOf("--extra-experimental-features") + 1], "nix-command flakes");
  for (const required of [
    "sandbox",
    "sandbox-fallback",
    "sandbox-paths",
    "extra-sandbox-paths",
    "builders",
    "trusted-public-keys",
  ]) {
    assert.ok(args.includes(required), `missing ${required}`);
  }
  assert.equal(args[args.indexOf("sandbox") + 1], "true");
  assert.equal(args[args.indexOf("sandbox-fallback") + 1], "false");
  assert.equal(args[args.indexOf("sandbox-paths") + 1], reviewedArtifactSandboxPaths().join(" "));
  assert.equal(args[args.indexOf("extra-sandbox-paths") + 1], "");
  assert.equal(args.includes("substituters"), false);
  assert.equal(args.includes("extra-substituters"), false);
  assert.equal(args.includes("fallback"), false);
});

test("artifact sandbox paths admit only the Darwin shell launcher dependency", () => {
  assert.deepEqual(reviewedArtifactSandboxPaths("darwin"), ["/bin/bash"]);
  assert.deepEqual(reviewedArtifactSandboxPaths("linux"), []);
});

test("independent Nix commands pin exact reviewed or empty cache authority", () => {
  const reviewed = artifactNixIndependentPolicyArgs("reviewed");
  assert.equal(
    reviewed[reviewed.indexOf("substituters") + 1],
    REVIEWED_REQUIRED_SUBSTITUTERS.join(" "),
  );
  assert.equal(reviewed[reviewed.indexOf("extra-substituters") + 1], "");
  assert.equal(reviewed[reviewed.indexOf("fallback") + 1], "true");
  for (const optional of REVIEWED_OPTIONAL_SUBSTITUTERS) {
    assert.equal(reviewed.includes(optional), false);
  }

  const empty = artifactNixIndependentPolicyArgs("empty");
  assert.equal(empty[empty.indexOf("substituters") + 1], "");
  assert.equal(empty[empty.indexOf("extra-substituters") + 1], "");
});

test("independent artifact callers do not rely on an ambient command scope", () => {
  assert.match(
    read("build-tools/tools/ci/artifact-command.ts"),
    /artifactNixIndependentPolicyArgs\("reviewed"\)/,
  );
  const materialize = read("build-tools/tools/remote-exec/nix-store-materialize.ts");
  assert.match(materialize, /artifactNixIndependentPolicyArgs\("reviewed"\)/);
  assert.match(materialize, /artifactNixIndependentPolicyArgs\("empty"\)/);
});

test("scoped selected-build action environments inherit canonical reviewed config centrally", () => {
  for (const rel of [
    "build-tools/tools/dev/nix-build-filtered-flake.ts",
    "build-tools/tools/dev/build-selected.ts",
  ]) {
    const source = read(rel);
    assert.equal(
      source.match(/nixCachePolicyCapability: currentNixCachePolicyCapability\(\)/g)?.length,
      2,
      `${rel} must propagate reviewed config through both artifact environments`,
    );
  }
  const boundary = read("build-tools/tools/lib/artifact-environment.ts");
  assert.match(boundary, /outcomeFromNixCachePolicyCapability/);
  assert.match(boundary, /policy\.kind === "reviewed"/);
});

test("filtered-flake test helper binds reviewed cache authority", () => {
  const source = read("build-tools/tools/tests/lib/test-helpers/selected-build.ts");
  assert.match(source, /proofBoundCachePolicyOutcome\(process\.env\)/);
  assert.match(source, /selectedBuildNixCachePolicyCapability\(\)/);
  assert.match(source, /\{ nixCachePolicyCapability \}/);
});

test("CI graph builds and cache admission cannot fail open or claim impure evaluation", () => {
  const stage = read("build-tools/tools/ci/run-stage.ts");
  assert.match(stage, /chooseRunnableFlakeRef/);
  assert.doesNotMatch(stage, /attribute missing; skipping|catch \(e\)/);
  const cache = read("build-tools/tools/ci/cache-publication-policy.ts");
  assert.match(cache, /impureEvaluation: false/);
});

test("network-capable Nix sources have exact fixed-output or runtime ownership", () => {
  assertArtifactNetworkPolicyInventory();
});

test("only cache-health renderers construct substituter configuration", () => {
  const allowed = new Set(
    [
      "build-tools/lang/nix_cache_health.bzl",
      "build-tools/tools/bin/devshell-cache-health.sh",
      "build-tools/tools/dev/verify/nix-cache-health.ts",
      "build-tools/tools/dev/verify/nix-cache-health-config.ts",
      "build-tools/tools/dev/verify/nix-cache-health-result.ts",
      "build-tools/tools/lib/consumer-direnv.ts",
    ].map(viberootsSourcePath),
  );
  const directConstruction = /--option\s+(?:extra-)?substituters|["'`](?:extra-)?substituters\s*=/u;
  const offenders = productionFiles(viberootsSourcePath("build-tools"))
    .filter((file) => !allowed.has(file))
    .filter((file) => directConstruction.test(fs.readFileSync(file, "utf8")))
    .map((file) => path.relative(viberootsSourcePath("."), file))
    .sort();
  assert.deepEqual(offenders, []);
});
