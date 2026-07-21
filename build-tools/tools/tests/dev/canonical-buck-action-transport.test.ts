#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { canonicalBuckActionTransport } from "../../dev/canonical-buck-action-transport";
import {
  artifactToolsRoot,
  buckTransportFixture as fixture,
  canonicalNode,
} from "./canonical-buck-action-transport.fixture";

test("declared Buck selectors become canonical argv and leave the environment", async () => {
  const { root, graph, manifest, stateRoot, marker, artifactMarker } = await fixture();
  try {
    const result = canonicalBuckActionTransport(
      [
        "--buck-action-inputs",
        manifest,
        "--buck-action-state-root",
        stateRoot,
        "--workspace-root-marker",
        marker,
        "--artifact-tools-marker",
        artifactMarker,
        "--planner-only-cpp",
        "--coverage",
      ],
      {
        WORKSPACE_ROOT: "/host/ambient-workspace",
        BUCK_TEST_SRC: root,
        BUCK_GRAPH_JSON: graph,
        PLANNER_ONLY_CPP: "1",
        COVERAGE: "1",
        BUCK_BUILD_ID: "runtime-only",
        NIX_PNPM_FETCH_TIMEOUT: "600",
        RUST_BACKTRACE: "1",
        VBR_ARTIFACT_TOOLS_ROOT: artifactToolsRoot,
        VIBEROOTS_ROOT: "/host/source",
        VIBEROOTS_SOURCE_ROOT: "/host/source",
      },
      true,
      canonicalNode,
    );
    assert.equal(result.workspaceRoot, root);
    assert.ok(result.argv.includes(`--workspace-root=${root}`));
    assert.ok(result.argv.includes(`--buck-test-src=${root}`));
    assert.ok(result.argv.includes(`--buck-graph-json=${graph}`));
    assert.ok(result.argv.includes("--planner-only-cpp"));
    assert.ok(result.argv.includes("--coverage"));
    for (const name of [
      "WORKSPACE_ROOT",
      "BUCK_TEST_SRC",
      "BUCK_GRAPH_JSON",
      "PLANNER_ONLY_CPP",
      "COVERAGE",
      "BUCK_BUILD_ID",
      "NIX_PNPM_FETCH_TIMEOUT",
      "RUST_BACKTRACE",
      "VBR_ARTIFACT_TOOLS_ROOT",
      "VIBEROOTS_ROOT",
      "VIBEROOTS_SOURCE_ROOT",
    ]) {
      assert.equal(result.env[name], undefined);
    }
    assert.equal(result.artifactToolsRoot, artifactToolsRoot);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("declared Buck workspace root must match its marker-derived authority", async () => {
  const { root, manifest, stateRoot, marker, artifactMarker } = await fixture();
  try {
    assert.throws(
      () =>
        canonicalBuckActionTransport(
          [
            "--buck-action-inputs",
            manifest,
            "--buck-action-state-root",
            stateRoot,
            "--workspace-root-marker",
            marker,
            "--artifact-tools-marker",
            artifactMarker,
            "--workspace-root=/",
          ],
          { BUCK_TEST_SRC: root, VBR_ARTIFACT_TOOLS_ROOT: artifactToolsRoot },
          true,
        ),
      /workspace root does not match its declared marker/,
    );
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("declared Buck workspace marker symlink must retain canonical declared authority", async () => {
  const { root, manifest, stateRoot, marker, artifactMarker } = await fixture();
  const target = path.join(root, "real-workspace-root.env");
  try {
    await fsp.writeFile(target, "# external marker\n");
    await fsp.rm(marker);
    await fsp.symlink(target, marker);
    const result = canonicalBuckActionTransport(
      [
        "--buck-action-inputs",
        manifest,
        "--buck-action-state-root",
        stateRoot,
        "--workspace-root-marker",
        marker,
        "--artifact-tools-marker",
        artifactMarker,
      ],
      { BUCK_TEST_SRC: root, VBR_ARTIFACT_TOOLS_ROOT: artifactToolsRoot },
      true,
      canonicalNode,
    );
    assert.equal(result.workspaceRoot, root);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("declared Buck graph must be a real action input", async () => {
  const { root, manifest, stateRoot, marker, artifactMarker } = await fixture();
  const undeclared = path.join(root, "undeclared.json");
  await fsp.writeFile(undeclared, "[]\n");
  try {
    assert.throws(
      () =>
        canonicalBuckActionTransport(
          [
            "--buck-action-inputs",
            manifest,
            "--buck-action-state-root",
            stateRoot,
            "--workspace-root-marker",
            marker,
            "--artifact-tools-marker",
            artifactMarker,
          ],
          {
            WORKSPACE_ROOT: root,
            BUCK_TEST_SRC: root,
            BUCK_GRAPH_JSON: undeclared,
            VBR_ARTIFACT_TOOLS_ROOT: artifactToolsRoot,
          },
          true,
          canonicalNode,
        ),
      /declared Buck graph is not present in the declared Buck action inputs/,
    );
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("ordinary entrypoints never admit Buck selector transport", () => {
  const source = { BUCK_GRAPH_JSON: "/host/graph.json" };
  const result = canonicalBuckActionTransport([], source, false);
  assert.deepEqual(result.argv, []);
  assert.deepEqual(result.env, source);
  assert.equal(result.workspaceRoot, "");
  assert.equal(result.artifactToolsRoot, "");
});
