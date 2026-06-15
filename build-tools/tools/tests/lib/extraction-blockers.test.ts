#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { findExtractionBlockers } from "../../lib/extraction-blockers";

async function tmpWorkspace(prefix: string): Promise<string> {
  const root = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), `${prefix}-`)));
  await fsp.writeFile(path.join(root, "flake.nix"), "{ outputs = _: {}; }\n", "utf8");
  await fsp.writeFile(path.join(root, ".buckroot"), ".\n", "utf8");
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
    await fsp.mkdir(path.join(root, "docs"), { recursive: true });
    await fsp.writeFile(
      path.join(root, "docs", "note.md"),
      'load("//build-tools/node:defs.bzl", "node_webapp")\n',
      "utf8",
    );

    assert.deepEqual(findExtractionBlockers(root), []);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
