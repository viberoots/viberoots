#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { makeFilteredFlakeRef } from "../../dev/filtered-flake";
import { DEFAULT_GRAPH_PATH } from "../../lib/workspace-state-paths";

test("selected filtered-flake snapshots preserve the active workspace graph", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "selected-filtered-graph-root-"));
  let snapshotRoot = "";
  try {
    await fsp.mkdir(path.join(root, ".viberoots", "workspace"), { recursive: true });
    await fsp.writeFile(path.join(root, ".viberoots", "workspace", "flake.nix"), "{}\n", "utf8");

    const graphPath = path.join(
      root,
      ".viberoots",
      "workspace",
      "buck",
      "selected",
      "t__projects_apps_pyapp_pyapp_lib.graph.json",
    );
    const graph = {
      $schema: "x",
      version: 1,
      nodes: [
        {
          name: "//projects/apps/pyapp:pyapp_lib",
          nixpkgs_profile: "default",
          nixpkg_pins: {
            "pkgs.OpenSSL": {
              nixpkgs_profile: "nixpkgs-23_11",
              rationale: "kept in graph for planner diagnostics",
            },
          },
        },
      ],
    };
    await fsp.mkdir(path.dirname(graphPath), { recursive: true });
    await fsp.writeFile(graphPath, JSON.stringify(graph, null, 2) + "\n", "utf8");
    await fsp.writeFile(
      path.join(root, DEFAULT_GRAPH_PATH),
      JSON.stringify({ $schema: "x", version: 1, nodes: [] }, null, 2) + "\n",
      "utf8",
    );

    const filtered = await makeFilteredFlakeRef({
      workspaceRoot: root,
      attr: "graph-generator-selected",
      logPrefix: "[test]",
      graphPath,
    });
    snapshotRoot = filtered.workspaceRoot;
    try {
      const copied = JSON.parse(
        await fsp.readFile(path.join(snapshotRoot, DEFAULT_GRAPH_PATH), "utf8"),
      );
      assert.deepEqual(copied, graph);
    } finally {
      await filtered.cleanup();
    }
  } finally {
    if (snapshotRoot) await fsp.rm(path.dirname(snapshotRoot), { recursive: true, force: true });
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("selected filtered-flake snapshots preserve node hash maps for pnpm targets", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "selected-filtered-node-root-"));
  let snapshotRoot = "";
  try {
    await fsp.mkdir(path.join(root, ".viberoots", "workspace"), { recursive: true });
    await fsp.writeFile(path.join(root, ".viberoots", "workspace", "flake.nix"), "{}\n", "utf8");
    await fsp.mkdir(path.join(root, "projects", "apps", "demo"), { recursive: true });
    await fsp.writeFile(
      path.join(root, "projects", "apps", "demo", "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(root, "projects", "node-modules.hashes.json"),
      '{ "projects/apps/demo/pnpm-lock.yaml": "sha256-test" }\n',
      "utf8",
    );

    const filtered = await makeFilteredFlakeRef({
      workspaceRoot: root,
      attr: "graph-generator-selected",
      logPrefix: "[test]",
      target: "//projects/apps/demo:app",
    });
    snapshotRoot = filtered.workspaceRoot;
    try {
      assert.equal(
        await fsp.readFile(path.join(snapshotRoot, "projects", "node-modules.hashes.json"), "utf8"),
        '{ "projects/apps/demo/pnpm-lock.yaml": "sha256-test" }\n',
      );
    } finally {
      await filtered.cleanup();
    }
  } finally {
    if (snapshotRoot) await fsp.rm(path.dirname(snapshotRoot), { recursive: true, force: true });
    await fsp.rm(root, { recursive: true, force: true });
  }
});
