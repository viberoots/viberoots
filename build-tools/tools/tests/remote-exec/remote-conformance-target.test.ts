#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { after, test } from "node:test";
import { killBuckIsolation } from "../../dev/verify/process-control";
import { collectRemoteExecTargetMetadata } from "../../dev/verify/remote-target-policy";
import { parseVerifyExecutionPolicy } from "../../dev/verify/remote-policy";
import { validateRemoteExecTargets } from "../../dev/remote-exec-policy-check";
import { remoteBuilderSmokeEvidence } from "./remote-builder-smoke-test-fixture";
import { normalizeTargetLabel } from "../../lib/labels";
import { inheritedBuckIsolation } from "../lib/test-helpers";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";
import { consumeNestedCacheRoleTransport } from "../../dev/verify/nested-cache-role-transport";

const tinyTarget =
  "viberoots//build-tools/tools/tests/remote-exec/wrapper-fixtures:zx_ready_handles";
const tinyTargetCanonical =
  "viberoots//build-tools/tools/tests/remote-exec/wrapper-fixtures:zx_ready_handles";
const rustBuildReadyTarget =
  "viberoots//build-tools/tools/tests/remote-exec/wrapper-fixtures:rust_build_ready_policy";
const rustTestReadyTarget =
  "viberoots//build-tools/tools/tests/remote-exec/wrapper-fixtures:rust_ready_handles";
const expectedRemoteReadyFixtureTargets = [
  "//build-tools/tools/tests/remote-exec/wrapper-fixtures:cpp_ready_handles",
  "//build-tools/tools/tests/remote-exec/wrapper-fixtures:go_ready_handles",
  "//build-tools/tools/tests/remote-exec/wrapper-fixtures:node_ready_handles",
  "//build-tools/tools/tests/remote-exec/wrapper-fixtures:python_ready_handles",
  "//build-tools/tools/tests/remote-exec/wrapper-fixtures:rust_build_ready_policy",
  "//build-tools/tools/tests/remote-exec/wrapper-fixtures:rust_ready_handles",
  "//build-tools/tools/tests/remote-exec/wrapper-fixtures:zx_ready_handles",
];
const localPolicy = parseVerifyExecutionPolicy({ env: {} });
const wrapperFixturesScope = "viberoots//build-tools/tools/tests/remote-exec/wrapper-fixtures/...";
const metadataIsolation = inheritedBuckIsolation("remote_conformance_target_metadata");
const providersIsolation = inheritedBuckIsolation("remote_conformance_provider_inputs");
const runnerIsolation = inheritedBuckIsolation("remote_conformance_runner_exec");
const rustSnapshotIsolation = inheritedBuckIsolation("rust_remote_snapshot_action");
const rustBuildIsolation = inheritedBuckIsolation("rust_remote_snapshot_build");
const rustTestIsolation = inheritedBuckIsolation("rust_remote_snapshot_test");
const readyQueryIsolation = inheritedBuckIsolation("remote_conformance_only_ready");
const nestedCacheTestArgs = consumeNestedCacheRoleTransport(process.env);

after(async () => await killBuckIsolation(process.cwd(), metadataIsolation));
after(async () => await killBuckIsolation(process.cwd(), providersIsolation));
after(async () => await killBuckIsolation(process.cwd(), runnerIsolation));
after(async () => await killBuckIsolation(process.cwd(), rustSnapshotIsolation));
after(async () => await killBuckIsolation(process.cwd(), rustBuildIsolation));
after(async () => await killBuckIsolation(process.cwd(), rustTestIsolation));
after(async () => await killBuckIsolation(process.cwd(), readyQueryIsolation));

test("first local conformance target has target-derived readiness evidence", async () => {
  const metadata = collectRemoteExecTargetMetadata({
    root: process.cwd(),
    iso: metadataIsolation,
    executionPolicy: localPolicy,
    targets: [{ target: tinyTarget, labels: ["remote:ready"] }],
  });

  assert.equal(metadata.length, 1);
  assert.deepEqual(
    validateRemoteExecTargets({
      mode: "remote",
      testOnlyRemoteBuilderSmokeEvidence: remoteBuilderSmokeEvidence,
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
    await $`buck2 --isolation-dir ${providersIsolation} audit providers --target-platforms prelude//platforms:default ${tinyTarget}`;
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
    await $`buck2 --isolation-dir ${runnerIsolation} test --target-platforms prelude//platforms:default ${tinyTarget}`.nothrow();
  assert.equal(res.exitCode, 0, String(res.stderr || ""));
  assert.match(String(res.stdout || "") + String(res.stderr || ""), /remote-ready-runner: ok/);
});

test("Rust remote-ready build action structurally consumes its generated source snapshot", async () => {
  const result =
    await $`buck2 --isolation-dir ${rustSnapshotIsolation} aquery --target-platforms prelude//platforms:default "deps(${rustBuildReadyTarget})" --output-attribute cmd --output-format starlark`.nothrow();
  assert.equal(result.exitCode, 0, String(result.stderr || ""));
  const command = String(result.stdout || "");
  assert.match(command, /rust_ready_source_snapshot\.source-snapshot/);
  assert.match(command, /rust_ready_source_snapshot\.source-snapshot\.manifest\.json/);
  assert.match(command, /vbr-source-snapshot/);
  assert.match(command, /rsync[^;]+--delete/);
  assert.match(command, /export BUCK_GRAPH_JSON=[^;]+graph\.json/);
});

test("Rust remote-ready build executes behavior from the declared snapshot", async () => {
  const result =
    await $`buck2 --isolation-dir ${rustBuildIsolation} build --target-platforms prelude//platforms:default --show-output ${rustBuildReadyTarget}`.nothrow();
  assert.equal(result.exitCode, 0, String(result.stderr || ""));
  const output = String(result.stdout || "")
    .trim()
    .split(/\s+/u)
    .at(-1);
  assert.ok(output, `missing Rust build output: ${String(result.stdout || "")}`);
  const executed = await $({ stdio: "pipe" })`${output}`.nothrow();
  assert.equal(executed.exitCode, 0, String(executed.stderr || ""));
  assert.equal(String(executed.stdout || "").trim(), "rust-remote-snapshot-v1");
});

test("Rust remote-ready test executes its real snapshot-backed Cargo harness", async () => {
  if (process.env.NIX_CONFIG) {
    assert.equal(
      nestedCacheTestArgs.length,
      10,
      "nested Buck test requires proof-bound config plus four cache roles",
    );
  }
  const result =
    await $`buck2 --isolation-dir ${rustTestIsolation} test --target-platforms prelude//platforms:default ${rustTestReadyTarget} -- ${nestedCacheTestArgs}`.nothrow();
  assert.equal(result.exitCode, 0, String(result.stderr || ""));
  const output = String(result.stdout || "") + String(result.stderr || "");
  assert.match(output, /rust_ready_handles/u);
  assert.match(output, /\bpass\b/iu);
});

test("only declared wrapper fixtures are remote-ready in the Buck graph", async () => {
  const res =
    await $`buck2 --isolation-dir ${readyQueryIsolation} cquery --target-platforms prelude//platforms:default --json --output-attribute labels ${wrapperFixturesScope}`.nothrow();
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

test("all initial remote-ready conformance fixtures are documented", async () => {
  const doc = await fs.readFile(
    viberootsSourcePath("viberoots/build-tools/docs/remote-build-setup.md"),
    "utf8",
  );
  const checklist = doc.match(
    /The initial `remote:ready` local\/dry-run conformance targets are:\n\n((?:- `[^`]+`\n)+)/,
  );
  assert.ok(checklist?.[1], "missing initial remote-ready conformance target checklist");
  const documentedTargets = [...checklist[1].matchAll(/^- `([^`]+)`$/gm)]
    .map((match) => match[1])
    .sort();

  assert.deepEqual(documentedTargets, expectedRemoteReadyFixtureTargets);
  assert.match(
    doc,
    /including real Rust build and test execution from a dedicated snapshot containing/,
  );
  assert.match(doc, /Do not add a default Jenkins remote lane/);
});

test("Rust conformance snapshot stays self-contained without admitting unrelated test sources", async () => {
  const filter = await fs.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/nix/flake/packages/filter-repo.nix"),
    "utf8",
  );
  const targets = await fs.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/tests/remote-exec/wrapper-fixtures/TARGETS"),
    "utf8",
  );
  assert.match(filter, /isRootDir "build-tools\/tools\/tests"/);
  assert.match(targets, /destination_prefix = "projects\/fixtures\/rust-remote-ready"/);
  assert.match(targets, /planner_label = "\/\/projects\/fixtures\/rust-remote-ready:/);
});
