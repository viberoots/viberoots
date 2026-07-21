#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { makeFilteredFlakeRef } from "../../dev/filtered-flake";
import { DEFAULT_GRAPH_PATH } from "../../lib/workspace-state-paths";
import {
  buildCanonicalArtifactEnvironment,
  canonicalArtifactToolsRoot,
} from "../../lib/artifact-environment";

function contractTestEnv(workspaceRoot: string): NodeJS.ProcessEnv {
  return buildCanonicalArtifactEnvironment(workspaceRoot, {
    artifactToolsRoot: canonicalArtifactToolsRoot(
      process.cwd(),
      String(process.env.VBR_ARTIFACT_TOOLS_ROOT || ""),
    ),
  });
}

async function writeTargetGraph(root: string, target: string): Promise<void> {
  await fsp.writeFile(
    path.join(root, DEFAULT_GRAPH_PATH),
    JSON.stringify({ nodes: [{ name: target, deps: [], srcs: [] }] }, null, 2) + "\n",
  );
}

test("selected filtered-flake snapshots preserve the active workspace graph", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "selected-filtered-graph-root-"));
  try {
    await fsp.mkdir(path.join(root, ".viberoots", "workspace"), { recursive: true });
    await fsp.writeFile(path.join(root, ".viberoots", "workspace", "flake.nix"), "{}\n", "utf8");
    await fsp.mkdir(path.join(root, ".viberoots", "workspace", "buck"), { recursive: true });
    await fsp.writeFile(path.join(root, DEFAULT_GRAPH_PATH), "[]\n");

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
      env: contractTestEnv(root),
      selectorEnv: {},
    });
    try {
      const copied = JSON.parse(
        await fsp.readFile(path.join(filtered.workspaceRoot, DEFAULT_GRAPH_PATH), "utf8"),
      );
      assert.deepEqual(copied, graph);
    } finally {
      await filtered.cleanup();
    }
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("selected filtered-flake snapshots preserve node hash maps for pnpm targets", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "selected-filtered-node-root-"));
  let snapshotRoot = "";
  try {
    await fsp.mkdir(path.join(root, ".viberoots", "workspace"), { recursive: true });
    await fsp.writeFile(path.join(root, ".viberoots", "workspace", "flake.nix"), "{}\n", "utf8");
    await fsp.mkdir(path.join(root, ".viberoots", "workspace", "buck"), { recursive: true });
    await writeTargetGraph(root, "//projects/apps/demo:app");
    await fsp.mkdir(path.join(root, "projects", "apps", "demo"), { recursive: true });
    await fsp.writeFile(
      path.join(root, "projects", "apps", "demo", "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'\n",
      "utf8",
    );
    await fsp.mkdir(path.join(root, "projects", "config"), { recursive: true });
    await fsp.writeFile(
      path.join(root, "projects", "config", "node-modules.hashes.json"),
      '{ "projects/apps/demo/pnpm-lock.yaml": "sha256-test" }\n',
      "utf8",
    );

    const filtered = await makeFilteredFlakeRef({
      workspaceRoot: root,
      attr: "graph-generator-selected",
      logPrefix: "[test]",
      target: "//projects/apps/demo:app",
      env: contractTestEnv(root),
      selectorEnv: {},
    });
    snapshotRoot = filtered.workspaceRoot;
    try {
      assert.equal(
        await fsp.readFile(
          path.join(snapshotRoot, "projects", "config", "node-modules.hashes.json"),
          "utf8",
        ),
        '{ "projects/apps/demo/pnpm-lock.yaml": "sha256-test" }\n',
      );
    } finally {
      await filtered.cleanup();
    }
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("selected filtered-flake snapshots preserve a lockless target package", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "selected-filtered-lockless-root-"));
  let snapshotRoot = "";
  try {
    await fsp.mkdir(path.join(root, ".viberoots", "workspace"), { recursive: true });
    await fsp.writeFile(path.join(root, ".viberoots", "workspace", "flake.nix"), "{}\n");
    await fsp.mkdir(path.join(root, ".viberoots", "workspace", "buck"), { recursive: true });
    await writeTargetGraph(root, "//projects/apps/demo:app");
    const importer = path.join(root, "projects", "apps", "demo");
    await fsp.mkdir(path.join(importer, "src"), { recursive: true });
    await fsp.writeFile(path.join(importer, "TARGETS"), "# package marker\n");
    await fsp.writeFile(path.join(importer, "src", "index.ts"), "export {};\n");

    const filtered = await makeFilteredFlakeRef({
      workspaceRoot: root,
      attr: "graph-generator-selected",
      logPrefix: "[test]",
      target: "//projects/apps/demo:app",
      env: contractTestEnv(root),
      selectorEnv: {},
    });
    snapshotRoot = filtered.workspaceRoot;
    try {
      assert.equal(
        await fsp.readFile(path.join(snapshotRoot, "projects", "apps", "demo", "TARGETS"), "utf8"),
        "# package marker\n",
      );
      assert.equal(
        await fsp.readFile(
          path.join(snapshotRoot, "projects", "apps", "demo", "src", "index.ts"),
          "utf8",
        ),
        "export {};\n",
      );
    } finally {
      await filtered.cleanup();
    }
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("selected filtered-flake snapshots reject target packages outside the workspace", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "selected-filtered-escape-root-"));
  try {
    await fsp.mkdir(path.join(root, ".viberoots", "workspace", "buck"), { recursive: true });
    await fsp.writeFile(path.join(root, ".viberoots", "workspace", "flake.nix"), "{}\n");
    await fsp.writeFile(path.join(root, DEFAULT_GRAPH_PATH), "[]\n");
    for (const [target, diagnostic] of [
      ["//..:app", /selected target package escapes the workspace/],
      ["//../outside:app", /selected target package escapes the workspace/],
      ["//projects/apps/demo:app", /canonical Buck graph does not contain selected target/],
    ] as const) {
      await assert.rejects(
        makeFilteredFlakeRef({
          workspaceRoot: root,
          attr: "graph-generator-selected",
          logPrefix: "[test]",
          target,
          env: contractTestEnv(root),
          selectorEnv: {},
        }),
        diagnostic,
      );
    }
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("selected filtered-flake snapshots include only the target Go importer", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "selected-filtered-go-root-"));
  let snapshotRoot = "";
  try {
    await fsp.mkdir(path.join(root, ".viberoots", "workspace"), { recursive: true });
    await fsp.writeFile(path.join(root, ".viberoots", "workspace", "flake.nix"), "{}\n", "utf8");
    await fsp.mkdir(path.join(root, ".viberoots", "workspace", "buck"), { recursive: true });
    await writeTargetGraph(root, "//projects/libs/demo-lib:demo-lib");
    for (const importer of ["demo-lib", "unrelated"]) {
      const importerDir = path.join(root, "projects", "libs", importer);
      await fsp.mkdir(importerDir, { recursive: true });
      await fsp.writeFile(path.join(importerDir, "go.mod"), `module example.com/${importer}\n`);
      await fsp.writeFile(
        path.join(importerDir, "lib.go"),
        `package ${importer.replace("-", "")}\n`,
      );
    }

    const filtered = await makeFilteredFlakeRef({
      workspaceRoot: root,
      attr: "graph-generator-selected",
      logPrefix: "[test]",
      target: "//projects/libs/demo-lib:demo-lib",
      env: contractTestEnv(root),
      selectorEnv: {},
    });
    snapshotRoot = filtered.workspaceRoot;
    try {
      assert.equal(
        await fsp.readFile(
          path.join(snapshotRoot, "projects", "libs", "demo-lib", "go.mod"),
          "utf8",
        ),
        "module example.com/demo-lib\n",
      );
      await assert.rejects(fsp.access(path.join(snapshotRoot, "projects", "libs", "unrelated")));
    } finally {
      await filtered.cleanup();
    }
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
