#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { canonicalArtifactToolsRoot } from "../../lib/artifact-environment";
import { sourcePlanEvidenceFromGraph } from "../../lib/source-plan-evidence";
import { DEFAULT_GRAPH_PATH } from "../../lib/workspace-state-paths";
import {
  materializeNixStorePaths,
  parseMaterializationManifest,
} from "../../remote-exec/nix-store-materialize";
import { inheritedBuckIsolation } from "../lib/test-helpers";
import {
  buildCanonicalBundle,
  prepareRustConsumer,
  target,
} from "./rust.source-selection.identity-fixture";

const expectedPlan = {
  target,
  nixpkgs_profile: "default",
  nixpkg_pins: { "pkgs.zlib": { nixpkgs_profile: "default" } },
};

function rustIdentity(node: Record<string, unknown>) {
  return {
    cargo_manifest: node.cargo_manifest,
    cargo_lock: node.cargo_lock,
    crate: node.crate,
    features: node.features,
    default_features: node.default_features,
    profile: node.profile,
    target: node.target,
    labels: node.labels,
    nixpkgs_profile: node.nixpkgs_profile,
    nixpkg_pins: node.nixpkg_pins,
  };
}

async function assertRustSourceBytesAgree(roots: string[]): Promise<void> {
  for (const relative of ["Cargo.toml", "Cargo.lock", "build.rs", path.join("src", "main.rs")]) {
    const files = await Promise.all(roots.map((root) => fsp.readFile(path.join(root, relative))));
    for (const candidate of files.slice(1)) assert.deepEqual(candidate, files[0], relative);
  }
}

test("Rust identity agrees through filtered bundles and declared source snapshots", async () => {
  const workspace = await fsp.realpath(
    await fsp.mkdtemp(path.join(os.tmpdir(), "viberoots-rust-identity-")),
  );
  try {
    const immutableViberootsInputRoot = await prepareRustConsumer(workspace, $);
    const selected = await buildCanonicalBundle(
      workspace,
      "graph-generator-selected",
      immutableViberootsInputRoot,
    );
    const full = await buildCanonicalBundle(
      workspace,
      "graph-generator",
      immutableViberootsInputRoot,
    );

    const executed = await $({ stdio: "pipe" })`${path.join(selected.outPath, "bin", "app")}`;
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
    assert.deepEqual(sourcePlanEvidenceFromGraph(bundledGraph), [expectedPlan]);
    assert.deepEqual(sourcePlanEvidenceFromGraph(fullGraph), [expectedPlan]);

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
    assert.deepEqual(snapshot.sourcePlans, [expectedPlan]);
    await assertRustSourceBytesAgree([
      path.join(workspace, "projects", "apps", "rust-parity"),
      path.join(selected.bundleSource, "projects", "apps", "rust-parity"),
      path.join(full.bundleSource, "projects", "apps", "rust-parity"),
      snapshotRoot,
    ]);

    const artifactToolsRoot = canonicalArtifactToolsRoot(process.cwd());
    const immutableFlakeRoot = path.join(selected.bundleSource, ".viberoots", "workspace");
    await fsp.access(path.join(immutableFlakeRoot, "flake.nix"));
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
          path: selected.outPath,
          expectedOutputIdentity: path.basename(selected.outPath),
        },
      ],
    });
    const [prepared] = await materializeNixStorePaths({
      manifest: remotePreparation,
      artifactToolsRoot,
      dryRun: true,
    });
    assert.ok(prepared);
    assert.equal(prepared.cache, "dry-run");
    assert.ok(prepared.command.includes(`${immutableFlakeRoot}#graph-generator-selected`));
    assert.equal(prepared.path, selected.outPath);
  } finally {
    await fsp.rm(workspace, { recursive: true, force: true });
  }
});
