#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { findExtractionBlockers } from "../../lib/extraction-blockers";

async function tmpWorkspace(prefix: string): Promise<string> {
  const root = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), `${prefix}-`)));
  await fsp.writeFile(path.join(root, ".buckroot"), ".\n", "utf8");
  await fsp.mkdir(path.join(root, "projects"), { recursive: true });
  await fsp.mkdir(path.join(root, "viberoots"), { recursive: true });
  await fsp.writeFile(path.join(root, "README.md"), "consumer\n", "utf8");
  return root;
}

test("extraction blocker detection reports old root paths and active legacy Buck refs", async () => {
  const root = await tmpWorkspace("vbr-extraction-blockers");
  try {
    await fsp.mkdir(path.join(root, "build-tools"), { recursive: true });
    await fsp.mkdir(path.join(root, "third_party", "providers"), { recursive: true });
    await fsp.mkdir(path.join(root, "projects", "apps", "demo"), { recursive: true });
    await fsp.writeFile(
      path.join(root, "projects", "apps", "demo", "TARGETS"),
      [
        'load("//build-tools/node:defs.bzl", "node_webapp")',
        'deps = ["//third_party/providers:pnpm_lock"]',
        "",
      ].join("\n"),
      "utf8",
    );

    const blockers = findExtractionBlockers(root);
    const summary = blockers.map((b) => `${b.kind}:${b.path}`);
    assert.deepEqual(summary, [
      "path:build-tools",
      "path:third_party",
      "path:third_party/providers",
      "buck-load:projects/apps/demo/TARGETS",
      "buck-label:projects/apps/demo/TARGETS",
    ]);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("extraction blocker detection ignores legacy references in non-active docs", async () => {
  const root = await tmpWorkspace("vbr-extraction-blockers-docs");
  try {
    await fsp.mkdir(path.join(root, ".notes"), { recursive: true });
    await fsp.writeFile(
      path.join(root, ".notes", "note.md"),
      'load("@viberoots//build-tools/node:defs.bzl", "node_webapp")\n',
      "utf8",
    );

    assert.deepEqual(findExtractionBlockers(root), []);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("extraction blocker detection enforces the visible root allowlist", async () => {
  const root = await tmpWorkspace("vbr-extraction-blockers-visible-root");
  try {
    await fsp.writeFile(path.join(root, "AGENTS.md"), "follow viberoots/AGENTS.md\n", "utf8");
    await fsp.writeFile(path.join(root, "test-tmp-paths.log"), "/tmp/owned-fixture\n", "utf8");
    await fsp.writeFile(path.join(root, "Jenkinsfile"), "pipeline {}\n", "utf8");
    await fsp.mkdir(path.join(root, "buck-out"), { recursive: true });
    await fsp.mkdir(path.join(root, "plugins"), { recursive: true });

    const blockers = findExtractionBlockers(root).map((b) => `${b.kind}:${b.path}`);
    assert.deepEqual(blockers, ["path:Jenkinsfile", "path:plugins"]);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("extraction blocker detection scans active templates and generated workspace state", async () => {
  const root = await tmpWorkspace("vbr-extraction-blockers-active-generated");
  try {
    await fsp.mkdir(
      path.join(root, "viberoots", "build-tools", "tools", "scaffolding", "templates", "cpp"),
      { recursive: true },
    );
    await fsp.mkdir(path.join(root, ".viberoots", "workspace", "providers"), {
      recursive: true,
    });
    await fsp.writeFile(
      path.join(
        root,
        "viberoots",
        "build-tools",
        "tools",
        "scaffolding",
        "templates",
        "cpp",
        "TARGETS.jinja",
      ),
      'deps = ["//third_party/providers:nix_pkgs_googletest"]\n',
      "utf8",
    );
    await fsp.writeFile(
      path.join(root, ".viberoots", "workspace", "providers", "TARGETS.node.auto"),
      'load("//build-tools/node:defs.bzl", "nix_node_lib")\n',
      "utf8",
    );

    const summary = findExtractionBlockers(root).map((b) => `${b.kind}:${b.path}`);
    assert.deepEqual(summary, [
      "buck-label:viberoots/build-tools/tools/scaffolding/templates/cpp/TARGETS.jinja",
      "buck-load:.viberoots/workspace/providers/TARGETS.node.auto",
    ]);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("extraction blocker detection does not follow generated workspace symlinks", async () => {
  const root = await tmpWorkspace("vbr-extraction-blockers-generated-symlink");
  const linked = await fsp.realpath(
    await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-extraction-blockers-linked-")),
  );
  try {
    await fsp.mkdir(path.join(root, ".viberoots", "workspace", "buck"), {
      recursive: true,
    });
    await fsp.mkdir(path.join(linked, "viberoots", "build-tools"), { recursive: true });
    await fsp.writeFile(
      path.join(linked, "viberoots", "build-tools", "TARGETS"),
      'deps = ["//third_party/providers:stale"]\n',
      "utf8",
    );
    await fsp.symlink(linked, path.join(root, ".viberoots", "workspace", "buck", "verify-seed"));

    assert.deepEqual(findExtractionBlockers(root), []);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
    await fsp.rm(linked, { recursive: true, force: true });
  }
});
