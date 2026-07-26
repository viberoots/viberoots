#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { sourcePlanEvidenceFromGraph } from "../../lib/source-plan-evidence";
import { DEFAULT_GRAPH_PATH } from "../../lib/workspace-state-paths";
import { runAsyncCleanupSteps, withAsyncCleanup } from "../lib/test-helpers/async-cleanup";
import { killBuckDaemonsForRepo } from "../lib/test-helpers/buck-kill";
import { inheritedBuckIsolation } from "../lib/test-helpers";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";
import {
  buildCanonicalBundle,
  prepareRustConsumer,
  target,
  testTarget,
} from "./rust.source-selection.identity-fixture";
import {
  assertActualRustBuckSnapshotExecution,
  assertRustSourceBytesAgree,
  expectedPlan,
  rustIdentity,
} from "./rust.source-selection.identity-assertions";
import { assertPreparedRemoteMaterialization } from "./rust.source-selection.identity-preparation";

test("Rust identity agrees through filtered bundles and declared source snapshots", async () => {
  const workspace = await fsp.realpath(
    await fsp.mkdtemp(path.join(os.tmpdir(), "viberoots-rust-identity-")),
  );
  const hostileBin = path.join(workspace, "hostile-bin");
  await withAsyncCleanup(
    async () => {
      await fsp.mkdir(hostileBin);
      for (const tool of ["cargo", "rustc", "nix", "pkg-config"]) {
        const toolPath = path.join(hostileBin, tool);
        await fsp.writeFile(toolPath, `#!/bin/sh\necho hostile-${tool} >&2\nexit 97\n`, "utf8");
        await fsp.chmod(toolPath, 0o755);
      }
      const hostileWorkerEnv = {
        ...process.env,
        PATH: `${hostileBin}${path.delimiter}${String(process.env.PATH || "")}`,
        CARGO_HOME: path.join(workspace, "hostile-cargo-home"),
        RUSTUP_HOME: path.join(workspace, "hostile-rustup-home"),
        RUSTFLAGS: "-C link-arg=/definitely/host-only",
      };
      const immutableViberootsInputRoot = await prepareRustConsumer(workspace, $);
      const selected = await buildCanonicalBundle(
        workspace,
        "graph-generator-selected",
        immutableViberootsInputRoot,
        hostileWorkerEnv,
      );
      const hostileReplay = await buildCanonicalBundle(
        workspace,
        "graph-generator-selected",
        immutableViberootsInputRoot,
        {
          ...hostileWorkerEnv,
          CARGO_HOME: path.join(workspace, "different-hostile-cargo-home"),
          RUSTFLAGS: "-C link-arg=/another/host-only",
        },
      );
      assert.equal(
        hostileReplay.outPath,
        selected.outPath,
        "hostile worker state changed the Rust store/cache identity",
      );
      const full = await buildCanonicalBundle(
        workspace,
        "graph-generator",
        immutableViberootsInputRoot,
        hostileWorkerEnv,
      );
      const executed = await $({
        env: hostileWorkerEnv,
        stdio: "pipe",
      })`${path.join(selected.outPath, "bin", "app")}`;
      assert.equal(String(executed.stdout || "").trim(), "rust-source-selection-ok");
      const fullManifest = JSON.parse(
        await fsp.readFile(path.join(full.outPath, "manifest.json"), "utf8"),
      );
      assert.deepEqual(
        fullManifest.map((entry: any) => entry.label),
        [target],
      );
      assert.equal(fullManifest[0].bins[0], path.join(selected.outPath, "bin", "app"));

      const localGraph = JSON.parse(
        await fsp.readFile(path.join(workspace, DEFAULT_GRAPH_PATH), "utf8"),
      );
      const bundledGraph = JSON.parse(
        await fsp.readFile(path.join(selected.bundleSource, DEFAULT_GRAPH_PATH), "utf8"),
      );
      assert.deepEqual(rustIdentity(bundledGraph[0]), rustIdentity(localGraph[0]));
      const fullGraph = JSON.parse(
        await fsp.readFile(path.join(full.bundleSource, DEFAULT_GRAPH_PATH), "utf8"),
      );
      assert.deepEqual(rustIdentity(fullGraph[0]), rustIdentity(localGraph[0]));
      assert.deepEqual(sourcePlanEvidenceFromGraph(bundledGraph), [
        expectedPlan(target),
        expectedPlan(testTarget),
      ]);
      assert.deepEqual(sourcePlanEvidenceFromGraph(fullGraph), [
        expectedPlan(target),
        expectedPlan(testTarget),
      ]);

      const built = await $({
        cwd: workspace,
        stdio: "pipe",
      })`buck2 --isolation-dir ${inheritedBuckIsolation("rust_identity_snapshot")} build //projects/apps/rust-parity:remote-snapshot --show-full-output`;
      const outputs = String(built.stdout || "")
        .trim()
        .split("\n")
        .map((line) => line.trim().split(/\s+/).at(-1) || "")
        .map((output) => (path.isAbsolute(output) ? output : path.join(workspace, output)));
      const snapshotRoot = outputs.find((output) => output.endsWith(".source-snapshot"));
      assert.ok(snapshotRoot, `missing declared source snapshot in ${String(built.stdout || "")}`);
      const snapshotManifest = `${snapshotRoot}.manifest.json`;
      await fsp.access(snapshotManifest);

      const remoteGraph = JSON.parse(
        await fsp.readFile(path.join(snapshotRoot, DEFAULT_GRAPH_PATH), "utf8"),
      );
      assert.deepEqual(rustIdentity(remoteGraph[0]), rustIdentity(localGraph[0]));
      const snapshot = JSON.parse(await fsp.readFile(snapshotManifest, "utf8"));
      assert.deepEqual(snapshot.sourcePlans, [expectedPlan(target), expectedPlan(testTarget)]);
      await assertRustSourceBytesAgree([
        path.join(workspace, "projects", "apps", "rust-parity"),
        path.join(selected.bundleSource, "projects", "apps", "rust-parity"),
        path.join(full.bundleSource, "projects", "apps", "rust-parity"),
        path.join(snapshotRoot, "projects", "apps", "rust-parity"),
      ]);

      await assertPreparedRemoteMaterialization({
        workspace,
        selectedBundleSource: selected.bundleSource,
        immutableViberootsInputRoot,
        hostileWorkerEnv,
      });

      const executionSnapshot = path.join(workspace, "remote-execution-snapshot");
      const executionSnapshotManifest = path.join(workspace, "remote-execution-snapshot.json");
      await $({
        cwd: workspace,
        stdio: "pipe",
      })`zx-wrapper ${viberootsSourcePath("viberoots/build-tools/tools/dev/source-snapshot.ts")} --workspace-root ${workspace} --out ${executionSnapshot} --manifest ${executionSnapshotManifest} --graph ${path.join(workspace, DEFAULT_GRAPH_PATH)} --declared-root ${executionSnapshot} --declared-graph ${path.join(executionSnapshot, DEFAULT_GRAPH_PATH)}`;
      const executionEvidence = JSON.parse(await fsp.readFile(executionSnapshotManifest, "utf8"));
      assert.equal(executionEvidence.declaredSnapshotRoot, executionSnapshot);
      assert.equal(
        executionEvidence.graphPathInSnapshot,
        DEFAULT_GRAPH_PATH,
        "remote execution snapshot must carry its selected-build graph",
      );

      await fsp.writeFile(
        path.join(workspace, "projects", "apps", "rust-parity", "src", "main.rs"),
        'compile_error!("ambient checkout must not be consumed");\n',
      );
      const snapshotReplay = await buildCanonicalBundle(
        executionSnapshot,
        "graph-generator-selected",
        immutableViberootsInputRoot,
        hostileWorkerEnv,
      );
      assert.equal(
        snapshotReplay.outPath,
        selected.outPath,
        "declared snapshot bytes did not preserve the selected Rust artifact identity",
      );
      const snapshotExecution = await $({
        env: hostileWorkerEnv,
        stdio: "pipe",
      })`${path.join(snapshotReplay.outPath, "bin", "app")}`;
      assert.equal(String(snapshotExecution.stdout || "").trim(), "rust-source-selection-ok");

      await assertActualRustBuckSnapshotExecution(workspace, hostileWorkerEnv);
    },
    async () =>
      await runAsyncCleanupSteps([
        async () => await killBuckDaemonsForRepo(workspace, $),
        async () => await fsp.rm(workspace, { recursive: true, force: true }),
      ]),
  );
  await assert.rejects(fsp.access(workspace), /ENOENT/);
});
