#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  graphDeclaredRootSourcePaths,
  graphDeclaredProviderEdges,
  graphDeclaredActionInputPaths,
  graphNodesFromJson,
  linkedWorkspacePackageName,
} from "../../dev/nix-build-filtered-flake-lib";
import { buildToolsRoot } from "../../dev/dev-build/paths";
import {
  assertDeclaredBuckActionInput,
  readDeclaredBuckActionInputs,
} from "../../dev/nix-build-filtered-flake";
import { materializeDeclaredImporterInputs } from "../../dev/nix-build-filtered-flake-declared-inputs";

const toolsRoot = buildToolsRoot(process.cwd());

function buildToolsSource(relative: string): string {
  return fs.readFileSync(path.join(toolsRoot, relative), "utf8");
}

test("selected graph source inventory includes exact root files without broadening", () => {
  const graph = graphNodesFromJson([
    {
      name: "root//:app",
      deps: ["root//:dep", "root//generated:output"],
      srcs: ["root///app/input.txt", "other///external.txt", "root//generated:output"],
    },
    { name: "root//:dep", deps: [], srcs: { input: "root///dep/input.txt" } },
    { name: "root//:other", deps: [], srcs: ["root///adjacent/ignored.txt"] },
  ]);
  assert.deepEqual(graphDeclaredRootSourcePaths(graph, "//:app"), [
    "app/input.txt",
    "dep/input.txt",
  ]);
  assert.deepEqual(graphDeclaredRootSourcePaths(graph), [
    "adjacent/ignored.txt",
    "app/input.txt",
    "dep/input.txt",
  ]);
  for (const invalid of ["root////absolute", "root///../escape", "root///a/./b", "root///a//b"])
    assert.throws(
      () => graphDeclaredRootSourcePaths([{ name: "//:bad", srcs: [invalid] }], "//:bad"),
      /invalid declared root source path/,
    );
});

test("selected graph action inventory contains only exact current-target inputs", () => {
  const graph = graphNodesFromJson([
    {
      name: "//projects/apps/demo:cli",
      srcs: {
        "projects/apps/demo/src/index.ts": "root//projects/apps/demo/src/index.ts",
        "__provider_edges__/inline": "root//projects/libs/inline:output",
      },
    },
    { name: "//projects/apps/other:cli", srcs: { "secret.txt": "root//secret.txt" } },
  ]);
  assert.deepEqual(graphDeclaredActionInputPaths(graph, "//projects/apps/demo:cli"), [
    "__provider_edges__/inline",
    "projects/apps/demo/src/index.ts",
  ]);
});

test("provider packages without manifests reject ambiguous output sets", () => {
  const source = fs.readFileSync(
    new URL("../../dev/nix-build-filtered-flake-declared-inputs.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /packageEdges\.length !== 1/);
  assert.match(source, /must declare exactly one output/);
  assert.match(source, /declaresManifest/);
  assert.match(source, /path\.basename\(source\) === "package\.json"/);
});

test("Node importer action sources reuse the filtered artifact source-role policy", () => {
  const helpers = buildToolsSource("node/defs_nix_helpers.bzl");
  const policy = buildToolsSource("lang/filtered_source_policy.bzl");
  assert.match(helpers, /FILTERED_ARTIFACT_SOURCE_GLOB_EXCLUDES/);
  assert.doesNotMatch(helpers, /_NODE_IMPORTER_SOURCE_EXCLUDES/);
  for (const excluded of [
    ".wasm-producer/**",
    ".full-test-output.log",
    ".patch-sessions.json",
    ".codex-*.log",
    "test-logs/**",
    ".aws/**",
    ".ssh/**",
    "node_modules/**",
    "buck-out/**",
  ]) {
    assert.ok(
      policy.includes(JSON.stringify(excluded)),
      `missing action-source exclusion ${excluded}`,
    );
  }
});

test("symlink materialization requires declared Buck input provenance", () => {
  const source = buildToolsSource("tools/dev/nix-build-filtered-flake-declared-inputs.ts");
  assert.doesNotMatch(source, /root\.includes\([^\n]*buck-out/);
  assert.match(source, /readDeclaredBuckActionInputs/);
  assert.match(source, /assertDeclaredBuckActionInput\(copySource/);
  assert.match(source, /assertDeclaredBuckActionInput\(source/);

  for (const relative of [
    "node/defs_nix.bzl",
    "node/defs_service.bzl",
    "node/defs_vercel.bzl",
    "node/private/nix_test.bzl",
  ]) {
    assert.match(buildToolsSource(relative), /--buck-action-inputs/);
  }
});

test("valid-looking action roots cannot admit undeclared external symlinks", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "buck-input-authority-"));
  try {
    const buckOut = path.join(root, "buck-out", "tmp", "build-selected");
    await fsp.mkdir(buckOut, { recursive: true });
    const declared = path.join(root, "declared.txt");
    const external = path.join(root, "external.txt");
    const link = path.join(root, "provider-link");
    await fsp.writeFile(declared, "declared\n");
    await fsp.writeFile(external, "external\n");
    await fsp.symlink(external, link);
    const manifest = path.join(buckOut, "declared-inputs.txt");
    await fsp.writeFile(manifest, `${await fsp.realpath(declared)}\n`);
    const inputs = await readDeclaredBuckActionInputs(manifest, root);
    await assert.rejects(
      assertDeclaredBuckActionInput(link, inputs, "provider"),
      /not an owned declared Buck input/,
    );
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("selected importer materializes manifest-declared Buck file symlinks", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "buck-importer-inputs-"));
  const snapDir = path.join(root, "snapshot");
  const importer = "projects/apps/demo";
  try {
    const external = path.join(root, "declared-answer.yml");
    const sourceLink = path.join(root, importer, ".copier-answers.yml");
    const snapshotLink = path.join(snapDir, importer, ".copier-answers.yml");
    const graphPath = path.join(root, "graph.json");
    await fsp.mkdir(path.dirname(sourceLink), { recursive: true });
    await fsp.mkdir(path.dirname(snapshotLink), { recursive: true });
    await fsp.writeFile(external, "name: demo\n");
    await fsp.symlink(external, sourceLink);
    await fsp.symlink(external, snapshotLink);
    await fsp.writeFile(graphPath, JSON.stringify([{ name: `//${importer}:demo`, srcs: {} }]));

    await materializeDeclaredImporterInputs({
      root,
      snapDir,
      graphPath,
      target: `//${importer}:demo`,
      importer,
      declaredActionInputs: new Set([await fsp.realpath(external)]),
    });

    assert.equal((await fsp.lstat(snapshotLink)).isSymbolicLink(), false);
    assert.equal(await fsp.readFile(snapshotLink, "utf8"), "name: demo\n");
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("linked workspace provider identity comes from the importer lock", () => {
  const lock = {
    importers: {
      ".": {
        dependencies: {
          "@libs/inline": { version: "link:../../libs/inline" },
          external: { version: "1.0.0" },
        },
      },
    },
  };
  assert.equal(
    linkedWorkspacePackageName(lock, "projects/apps/demo", "projects/libs/inline"),
    "@libs/inline",
  );
  assert.throws(
    () => linkedWorkspacePackageName(lock, "projects/apps/demo", "projects/libs/missing"),
    /expected one linked workspace package name/,
  );
});

test("selected graph provider inventory maps only declared action inputs to package paths", () => {
  const graph = graphNodesFromJson([
    {
      name: "root//projects/apps/demo:cli",
      srcs: {
        "__provider_edges__/projects-libs-inline-wasm":
          "root//projects/libs/inline:wasm (root//:platform#123)",
        "projects/apps/demo/src/index.ts": "root//projects/apps/demo/src/index.ts",
      },
    },
    {
      name: "root//projects/apps/other:cli",
      srcs: { "__provider_edges__/ignored": "root//projects/libs/ignored:output" },
    },
  ]);
  assert.deepEqual(graphDeclaredProviderEdges(graph, "//projects/apps/demo:cli"), [
    {
      actionPath: "__provider_edges__/projects-libs-inline-wasm",
      packagePath: "projects/libs/inline",
    },
  ]);
  assert.deepEqual(graphDeclaredProviderEdges(graph, "//projects/apps/missing:cli"), []);
  assert.throws(
    () =>
      graphDeclaredProviderEdges(
        [{ name: "//:bad", srcs: { "__provider_edges__/../escape": "//projects/libs/x:y" } }],
        "//:bad",
      ),
    /invalid declared root source path/,
  );
});
