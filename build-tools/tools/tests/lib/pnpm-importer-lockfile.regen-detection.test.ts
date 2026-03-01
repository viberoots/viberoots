#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { importerLockfileNeedsRegen } from "../../lib/pnpm-importer-lockfile";

async function withTempDir<T>(name: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), `${name}-`));
  try {
    return await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

test("importerLockfileNeedsRegen treats importer-local lockfile '.' as canonical", async () => {
  await withTempDir("pnpm-importer-lockfile", async (tmp) => {
    const importerRel = path.join("projects", "apps", "demo-web");
    const importerAbs = path.join(tmp, importerRel);
    await fsp.mkdir(importerAbs, { recursive: true });
    await fsp.writeFile(
      path.join(importerAbs, "package.json"),
      JSON.stringify(
        {
          name: "@apps/demo-web",
          private: true,
          dependencies: {
            react: "^18.3.1",
          },
          devDependencies: {
            typescript: "^5.6.3",
          },
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(importerAbs, "pnpm-lock.yaml"),
      [
        "lockfileVersion: '9.0'",
        "",
        "importers:",
        "  .:",
        "    dependencies:",
        "      react:",
        "        specifier: ^18.3.1",
        "        version: 18.3.1",
        "    devDependencies:",
        "      typescript:",
        "        specifier: ^5.6.3",
        "        version: 5.6.3",
        "",
        "packages:",
        "  react@18.3.1: {}",
        "  typescript@5.6.3: {}",
        "",
      ].join("\n"),
      "utf8",
    );

    const needsRegen = await importerLockfileNeedsRegen({
      repoRootAbs: tmp,
      importerRel,
    });
    assert.equal(needsRegen, false);
  });
});
