#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

async function readText(p: string): Promise<string> {
  return await fsp.readFile(p, "utf8");
}

async function toolScript(tmp: string, rel: string): Promise<string> {
  const local = path.join("build-tools", rel);
  if (
    await fsp
      .access(path.join(tmp, local))
      .then(() => true)
      .catch(() => false)
  ) {
    return local;
  }
  return path.join("viberoots", "build-tools", rel);
}

test("golden: Node importer provider TARGETS.node.auto is stable for representative fixture", async () => {
  await runInTemp("golden-node-provider-output", async (tmp, $) => {
    await $`git init`;

    // Keep the fixture focused on a single importer-owned lockfile under projects/apps/*.
    // The workspace copy may include a repo-root pnpm-lock.yaml used for tooling;
    // remove it here so the golden output remains stable and minimal.
    await fsp.rm(path.join(tmp, "pnpm-lock.yaml"), { force: true });
    await fsp.rm(path.join(tmp, "projects/apps/pleomino"), { recursive: true, force: true });

    const importerDir = path.join(tmp, "projects/apps/web");
    await fsp.mkdir(path.join(importerDir, "patches", "node"), { recursive: true });
    await fsp.writeFile(
      path.join(importerDir, "patches/node/zzz@9.9.9.patch"),
      "# patch\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(importerDir, "patches/node/aaa@1.0.0.patch"),
      "# patch\n",
      "utf8",
    );

    const lockfilePath = path.join(importerDir, "pnpm-lock.yaml");
    const lockfile = `
lockfileVersion: "9.0"

importers:
  projects/apps/web:
    dependencies:
      lodash:
        specifier: ^4.17.21
        version: 4.17.21

packages:
  /lodash@4.17.21:
    resolution: { integrity: sha512-abc... }
`.trim();
    await fsp.writeFile(lockfilePath, lockfile, "utf8");
    await $`git add projects/apps/web/pnpm-lock.yaml`;

    await $`node ${await toolScript(tmp, "tools/buck/sync-providers.ts")} --lang node --no-glue`;
    const out = await readText(path.join(tmp, ".viberoots/workspace/providers/TARGETS.node.auto"));

    const { providerNameForImporter } = await import("../../lib/providers");
    const name = providerNameForImporter("projects/apps/web/pnpm-lock.yaml", "projects/apps/web");
    const expected = [
      "# GENERATED FILE — DO NOT EDIT.",
      'load("@workspace_providers//:defs_node.bzl", "node_importer_deps")',
      "",
      `node_importer_deps(name="${name}", lockfile="projects/apps/web/pnpm-lock.yaml", importer="projects/apps/web", patch_paths=["projects/apps/web/patches/node/aaa@1.0.0.patch", "projects/apps/web/patches/node/zzz@9.9.9.patch"])`,
      "",
    ].join("\n");

    assert.equal(out, expected);
  });
});

test("golden: Python importer provider TARGETS.python.auto is stable for representative fixture", async () => {
  await runInTemp("golden-python-provider-output", async (tmp, $) => {
    const importerDir = path.join(tmp, "projects/libs/api");
    await fsp.mkdir(path.join(importerDir, "patches", "python"), { recursive: true });
    await fsp.writeFile(
      path.join(importerDir, "patches/python/requests@2.32.3.patch"),
      "# patch\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(importerDir, "patches/python/unused@1.0.0.patch"),
      "# patch\n",
      "utf8",
    );

    const lockfilePath = path.join(importerDir, "uv.lock");
    const uvLock = [
      "# uv.lock (minimal)",
      "[[package]]",
      'name = "requests"',
      'version = "2.32.3"',
      "",
      "[[package]]",
      'name = "urllib3"',
      'version = "2.2.3"',
      "",
    ].join("\n");
    await fsp.writeFile(lockfilePath, uvLock, "utf8");

    await $`node ${await toolScript(tmp, "tools/buck/sync-providers.ts")} --lang python`;
    const out = await readText(
      path.join(tmp, ".viberoots/workspace/providers/TARGETS.python.auto"),
    );

    const { providerNameForImporter } = await import("../../lib/providers");
    const name = providerNameForImporter("projects/libs/api/uv.lock", "projects/libs/api");
    const expected = [
      "# GENERATED FILE — DO NOT EDIT.",
      'load("@workspace_providers//:defs_python.bzl", "python_importer_deps")',
      "",
      `python_importer_deps(name="${name}", lockfile="projects/libs/api/uv.lock", importer="projects/libs/api", patch_paths=["projects/libs/api/patches/python/requests@2.32.3.patch"])`,
      "",
    ].join("\n");

    assert.equal(out, expected);
  });
});
