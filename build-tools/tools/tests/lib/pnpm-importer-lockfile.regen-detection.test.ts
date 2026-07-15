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

test("importerLockfileNeedsRegen preserves malformed lockfile failures", async () => {
  await withTempDir("pnpm-importer-lockfile-malformed", async (tmp) => {
    const importerRel = "app";
    const importerAbs = path.join(tmp, importerRel);
    await fsp.mkdir(importerAbs);
    await fsp.writeFile(path.join(importerAbs, "package.json"), "{}\n");
    await fsp.writeFile(path.join(importerAbs, "pnpm-lock.yaml"), "importers:\n  .: [\n");

    await assert.rejects(
      importerLockfileNeedsRegen({ repoRootAbs: tmp, importerRel }),
      /failed to parse pnpm lockfile with Nix yq: .*pnpm-lock\.yaml/,
    );
  });
});

test("importerLockfileNeedsRegen preserves missing lockfile failures", async () => {
  await withTempDir("pnpm-importer-lockfile-missing", async (tmp) => {
    const importerRel = "app";
    const importerAbs = path.join(tmp, importerRel);
    await fsp.mkdir(importerAbs);
    await fsp.writeFile(path.join(importerAbs, "package.json"), "{}\n");

    await assert.rejects(importerLockfileNeedsRegen({ repoRootAbs: tmp, importerRel }), {
      code: "ENOENT",
    });
  });
});

test("importerLockfileNeedsRegen preserves unreadable lockfile failures", async () => {
  await withTempDir("pnpm-importer-lockfile-unreadable", async (tmp) => {
    const importerRel = "app";
    const importerAbs = path.join(tmp, importerRel);
    const lock = path.join(importerAbs, "pnpm-lock.yaml");
    await fsp.mkdir(importerAbs);
    await fsp.writeFile(path.join(importerAbs, "package.json"), "{}\n");
    await fsp.writeFile(lock, "importers:\n  .: {}\npackages: {}\n");
    await fsp.chmod(lock, 0o000);
    try {
      await assert.rejects(
        importerLockfileNeedsRegen({ repoRootAbs: tmp, importerRel }),
        /failed to parse pnpm lockfile with Nix yq: .*pnpm-lock\.yaml/,
      );
    } finally {
      await fsp.chmod(lock, 0o600);
    }
  });
});

test("importerLockfileNeedsRegen bypasses a host yq earlier on PATH", async () => {
  await withTempDir("pnpm-importer-lockfile-host-yq", async (tmp) => {
    const importerRel = "app";
    const importerAbs = path.join(tmp, importerRel);
    const fakeBin = path.join(tmp, "host-bin");
    const marker = path.join(tmp, "host-yq-ran");
    await fsp.mkdir(importerAbs);
    await fsp.mkdir(fakeBin);
    await fsp.writeFile(path.join(importerAbs, "package.json"), "{}\n");
    await fsp.writeFile(
      path.join(importerAbs, "pnpm-lock.yaml"),
      "importers:\n  .: {}\npackages: {}\n",
    );
    await fsp.writeFile(
      path.join(fakeBin, "yq"),
      `#!/bin/sh\ntouch ${JSON.stringify(marker)}\nexit 91\n`,
      {
        mode: 0o755,
      },
    );
    const previousPath = process.env.PATH;
    process.env.PATH = `${fakeBin}${path.delimiter}${previousPath || ""}`;
    try {
      assert.equal(await importerLockfileNeedsRegen({ repoRootAbs: tmp, importerRel }), false);
      await assert.rejects(fsp.access(marker), { code: "ENOENT" });
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }
  });
});
