#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { filteredSnapshotSelection } from "../../dev/filtered-flake-snapshot-selection";

test("filtered-flake snapshots use a single graph-derived source authority", async () => {
  const filtered = await fsp.readFile(
    path.resolve("viberoots/build-tools/tools/dev/filtered-flake.ts"),
    "utf8",
  );
  assert.doesNotMatch(filtered, /process\.env\.VBR_ARTIFACT_TOOLS_ROOT/);
  assert.match(filtered, /env: NodeJS\.ProcessEnv/);
  assert.match(filtered, /selectorEnv: NodeJS\.ProcessEnv/);
  const consumer = await fsp.readFile(
    path.resolve("viberoots/build-tools/tools/dev/nix-build-filtered-flake.ts"),
    "utf8",
  );
  // Both public entrypoints (build-selected.ts via makeFilteredFlakeRef and
  // nix-build-filtered-flake.ts main()) MUST route through filteredSnapshotSelection.
  assert.match(consumer, /filteredSnapshotSelection\(root, target, /);
  assert.match(consumer, /requireGraph: Boolean\(target\)/);
  assert.doesNotMatch(consumer, /readSelected(?:Cpp|Node|Python)SnapshotSources/);
  assert.doesNotMatch(consumer, /readDefaultSnapshotSources/);
  const preparation = await fsp.readFile(
    path.resolve("viberoots/build-tools/tools/dev/nix-build-filtered-flake-preparation.ts"),
    "utf8",
  );
  assert.doesNotMatch(preparation, /readSelected(?:Cpp|Node|Python)SnapshotSources/);
  assert.doesNotMatch(preparation, /readDefaultSnapshotSources/);
  assert.match(filtered, /requireGraph: Boolean\(String\(opts\.target \|\| ""\)\.trim\(\)\)/);
});

test("selected artifact snapshots fail closed without their canonical graph", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "selected-snapshot-missing-graph-"));
  try {
    const missingGraph = path.join(root, ".viberoots", "workspace", "buck", "graph.json");
    await assert.rejects(
      filteredSnapshotSelection(root, "//projects/apps/demo:app", missingGraph),
      /selected artifact target requires the canonical Buck graph/,
    );

    const bootstrap = await filteredSnapshotSelection(root, "", missingGraph);
    assert.ok(bootstrap.relPaths.includes("flake.nix"));
    assert.deepEqual(bootstrap.declaredSources, []);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("package-scoped snapshots do not invent a synthetic Buck target", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "package-scoped-snapshot-"));
  try {
    const importer = "projects/apps/demo";
    await fsp.mkdir(path.join(root, importer), { recursive: true });
    const selection = await filteredSnapshotSelection(
      root,
      "",
      path.join(root, "missing-graph.json"),
      importer,
    );
    assert.ok(selection.relPaths.includes(importer));
    assert.deepEqual(selection.declaredSources, []);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
