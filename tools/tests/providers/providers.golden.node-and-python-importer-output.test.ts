#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

async function readText(p: string): Promise<string> {
  return await fsp.readFile(p, "utf8");
}

test("golden: Node importer provider TARGETS.node.auto is stable for representative fixture", async () => {
  await runInTemp("golden-node-provider-output", async (tmp, $) => {
    await $`git init`;

    // Keep the fixture focused on a single importer-owned lockfile under apps/*.
    // The workspace copy may include a repo-root pnpm-lock.yaml used for tooling;
    // remove it here so the golden output remains stable and minimal.
    await fsp.rm(path.join(tmp, "pnpm-lock.yaml"), { force: true });

    const importerDir = path.join(tmp, "apps/web");
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
  apps/web:
    dependencies:
      lodash:
        specifier: ^4.17.21
        version: 4.17.21

packages:
  /lodash@4.17.21:
    resolution: { integrity: sha512-abc... }
`.trim();
    await fsp.writeFile(lockfilePath, lockfile, "utf8");
    await $`git add apps/web/pnpm-lock.yaml`;

    await $`node tools/buck/sync-providers-node.ts`;
    const out = await readText(path.join(tmp, "third_party/providers/TARGETS.node.auto"));

    const { providerNameForImporter } = await import("../../lib/providers.ts");
    const name = providerNameForImporter("apps/web/pnpm-lock.yaml", "apps/web");
    const expected = [
      "# GENERATED FILE — DO NOT EDIT.",
      'load("//third_party/providers:defs_node.bzl", "node_importer_deps")',
      "",
      `node_importer_deps(name="${name}", lockfile="apps/web/pnpm-lock.yaml", importer="apps/web", patch_paths=["apps/web/patches/node/aaa@1.0.0.patch", "apps/web/patches/node/zzz@9.9.9.patch"])`,
      "",
    ].join("\n");

    assert.equal(out, expected);
  });
});

test("golden: Python importer provider TARGETS.python.auto is stable for representative fixture", async () => {
  await runInTemp("golden-python-provider-output", async (tmp, $) => {
    const importerDir = path.join(tmp, "libs/api");
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

    await $`node tools/buck/sync-providers.ts --lang python`;
    const out = await readText(path.join(tmp, "third_party/providers/TARGETS.python.auto"));

    const { providerNameForImporter } = await import("../../lib/providers.ts");
    const name = providerNameForImporter("libs/api/uv.lock", "libs/api");
    const expected = [
      "# GENERATED FILE — DO NOT EDIT.",
      'load("//third_party/providers:defs_python.bzl", "python_importer_deps")',
      "",
      `python_importer_deps(name="${name}", lockfile="libs/api/uv.lock", importer="libs/api", patch_paths=["libs/api/patches/python/requests@2.32.3.patch"])`,
      "",
    ].join("\n");

    assert.equal(out, expected);
  });
});
