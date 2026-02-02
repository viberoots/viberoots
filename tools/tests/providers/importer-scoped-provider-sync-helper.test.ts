#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { computeImporterLabel } from "../../lib/importers.ts";
import { decodeNameVersionFromPatch } from "../../lib/providers.ts";
import { parseUvLockKeys } from "../../lib/uv-lock.ts";
import { syncImporterScopedProviders } from "../../buck/providers/importer-scoped.ts";

function expectIncludes(haystack: string, needle: string) {
  assert.ok(haystack.includes(needle), `expected to include ${needle}`);
}

function expectNotIncludes(haystack: string, needle: string) {
  assert.ok(!haystack.includes(needle), `expected to exclude ${needle}`);
}

test("importer-scoped provider sync helper wires node and python configs", async () => {
  await runInTemp("providers-importer-scoped-helper", async (tmp, $) => {
    const prevCwd = process.cwd();
    const prevWorkspaceRoot = process.env.WORKSPACE_ROOT;
    try {
      process.env.WORKSPACE_ROOT = tmp;
      process.chdir(tmp);
      await $`git init`;

      await fsp.mkdir(path.join(tmp, "third_party/providers"), { recursive: true });

      const nodeImporter = "apps/web";
      const nodeLockfile = path.join(tmp, nodeImporter, "pnpm-lock.yaml");
      await fsp.mkdir(path.dirname(nodeLockfile), { recursive: true });
      await fsp.writeFile(nodeLockfile, "# lock\n", "utf8");

      const nodePatches = path.join(tmp, nodeImporter, "patches", "node");
      await fsp.mkdir(nodePatches, { recursive: true });
      await fsp.writeFile(path.join(nodePatches, "aaa@1.0.0.patch"), "# patch\n", "utf8");
      await fsp.writeFile(path.join(nodePatches, "zzz@9.9.9.patch"), "# patch\n", "utf8");

      const pythonImporter = "libs/api";
      const pythonLockfile = path.join(tmp, pythonImporter, "uv.lock");
      await fsp.mkdir(path.dirname(pythonLockfile), { recursive: true });
      const uvLock = [
        "[[package]]",
        'name = "requests"',
        'version = "2.32.3"',
        "",
        "[[package]]",
        'name = "urllib3"',
        'version = "2.2.3"',
        "",
      ].join("\n");
      await fsp.writeFile(pythonLockfile, uvLock, "utf8");

      const pythonPatches = path.join(tmp, pythonImporter, "patches", "python");
      await fsp.mkdir(pythonPatches, { recursive: true });
      await fsp.writeFile(path.join(pythonPatches, "requests@2.32.3.patch"), "# patch\n", "utf8");
      await fsp.writeFile(path.join(pythonPatches, "unused@1.0.0.patch"), "# patch\n", "utf8");

      await syncImporterScopedProviders({
        lang: "node",
        lockfileBasenames: ["pnpm-lock.yaml"],
        parseEffectiveSetForLockfile: async (lockfilePath) =>
          new Map([[computeImporterLabel(lockfilePath), new Set(["aaa@1.0.0"])]]),
        decodePatchKey: decodeNameVersionFromPatch,
      });

      await syncImporterScopedProviders({
        lang: "python",
        lockfileBasenames: ["uv.lock"],
        parseEffectiveSetForLockfile: async (lockfilePath) =>
          new Map([[computeImporterLabel(lockfilePath), await parseUvLockKeys(lockfilePath)]]),
        decodePatchKey: decodeNameVersionFromPatch,
      });

      const nodeOut = await fsp.readFile(
        path.join(tmp, "third_party/providers/TARGETS.node.auto"),
        "utf8",
      );
      const pythonOut = await fsp.readFile(
        path.join(tmp, "third_party/providers/TARGETS.python.auto"),
        "utf8",
      );

      expectIncludes(nodeOut, `${nodeImporter}/patches/node/aaa@1.0.0.patch`);
      expectIncludes(nodeOut, `${nodeImporter}/patches/node/zzz@9.9.9.patch`);
      expectIncludes(pythonOut, `${pythonImporter}/patches/python/requests@2.32.3.patch`);
      expectNotIncludes(pythonOut, `${pythonImporter}/patches/python/unused@1.0.0.patch`);
    } finally {
      process.chdir(prevCwd);
      if (prevWorkspaceRoot === undefined) {
        delete process.env.WORKSPACE_ROOT;
      } else {
        process.env.WORKSPACE_ROOT = prevWorkspaceRoot;
      }
    }
  });
});
