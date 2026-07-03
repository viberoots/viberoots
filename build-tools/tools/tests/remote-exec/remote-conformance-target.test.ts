#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { test } from "node:test";
import { collectRemoteExecTargetMetadata } from "../../dev/verify/remote-target-policy";
import { parseVerifyExecutionPolicy } from "../../dev/verify/remote-policy";
import { validateRemoteExecTargets } from "../../dev/remote-exec-policy-check";
import { normalizeTargetLabel } from "../../lib/labels";
import { inheritedBuckIsolation } from "../lib/test-helpers";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

const tinyTarget =
  "root//viberoots/build-tools/tools/tests/remote-exec/wrapper-fixtures:zx_ready_handles";
const tinyTargetCanonical =
  "//viberoots/build-tools/tools/tests/remote-exec/wrapper-fixtures:zx_ready_handles";
const expectedRemoteReadyFixtureTargets = [
  "//viberoots/build-tools/tools/tests/remote-exec/wrapper-fixtures:cpp_ready_handles",
  "//viberoots/build-tools/tools/tests/remote-exec/wrapper-fixtures:go_ready_handles",
  "//viberoots/build-tools/tools/tests/remote-exec/wrapper-fixtures:node_ready_handles",
  "//viberoots/build-tools/tools/tests/remote-exec/wrapper-fixtures:python_ready_handles",
  tinyTargetCanonical,
];
const localPolicy = parseVerifyExecutionPolicy({ env: {} });

test("first local conformance target has target-derived readiness evidence", async () => {
  const metadata = collectRemoteExecTargetMetadata({
    root: process.cwd(),
    iso: inheritedBuckIsolation("remote_conformance_target_metadata"),
    executionPolicy: localPolicy,
    targets: [{ target: tinyTarget, labels: ["remote:ready"] }],
  });

  assert.equal(metadata.length, 1);
  assert.deepEqual(
    validateRemoteExecTargets({
      mode: "remote",
      targets: metadata,
      allowedProfiles: ["linux-x86_64-default"],
    }),
    [],
  );
  assert.equal(metadata[0]?.sourceSnapshotRootDeclared, true);
  assert.equal(metadata[0]?.sourceSnapshotManifestDeclared, true);
  assert.equal(metadata[0]?.declaredGraphPath, true);
  assert.equal(metadata[0]?.declaredArtifactContract, true);
  assert.equal(metadata[0]?.materializationManifestDeclared, true);
  assert.equal(metadata[0]?.nixBuilderPolicy, "inherit_config");
  assert.equal(metadata[0]?.remoteBuilderSmokePolicy, "inherit_config");
  const providers =
    await $`buck2 --isolation-dir ${inheritedBuckIsolation("remote_conformance_provider_inputs")} audit providers --target-platforms prelude//platforms:default ${tinyTarget}`;
  const providerText = String(providers.stdout || "");
  for (const required of [
    "remote-ready-runner.sh",
    "noop.test.ts",
    "fixture.txt",
    "zx_ready_source_snapshot.source-snapshot",
    "zx_ready_source_snapshot.source-snapshot.manifest.json",
    "materialization-manifest.json",
    "artifact-contract.json",
    "tool-closure.json",
    "remote-builder-smoke.json",
    "zx-init.mjs",
    "command-heartbeat.ts",
    "node-modules-build.ts",
  ]) {
    assert.match(providerText, new RegExp(required.replaceAll(".", "\\.")));
  }
});

test("first local conformance target executes the dry-run runner", async () => {
  const res =
    await $`buck2 --isolation-dir ${inheritedBuckIsolation("remote_conformance_runner_exec")} test --target-platforms prelude//platforms:default ${tinyTarget}`.nothrow();
  assert.equal(res.exitCode, 0, String(res.stderr || ""));
  assert.match(String(res.stdout || "") + String(res.stderr || ""), /remote-ready-runner: ok/);
});

test("only declared wrapper fixtures are remote-ready in the Buck graph", async () => {
  const res =
    await $`buck2 --isolation-dir ${inheritedBuckIsolation("remote_conformance_only_ready")} cquery --target-platforms prelude//platforms:default --json --output-attribute labels //...`.nothrow();
  assert.equal(res.exitCode, 0, String(res.stderr || ""));
  const attrs = JSON.parse(String(res.stdout || "{}")) as Record<string, { labels?: string[] }>;
  const readyTargets = Object.entries(attrs)
    .filter(([, info]) => (info.labels || []).includes("remote:ready"))
    .map(([target]) => normalizeTargetLabel(target))
    .sort();

  assert.deepEqual(
    readyTargets,
    expectedRemoteReadyFixtureTargets,
    `unexpected remote-ready targets: ${readyTargets.join(", ")}`,
  );
});

test("only the tiny target is documented as initially remote-ready", async () => {
  const doc = await fs.readFile(
    viberootsSourcePath("viberoots/build-tools/docs/remote-build-setup.md"),
    "utf8",
  );
  const matches = [...doc.matchAll(/`([^`]+)` is the only initial `remote:ready` target/g)];

  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.[1], tinyTarget);
  assert.match(doc, /Do not add a default Jenkins remote lane/);
});
