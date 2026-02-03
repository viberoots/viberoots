#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { listImporterPatches } from "../../lib/importers";
import { runImporterProviderSync } from "../../lib/provider-sync-driver";
import { decodeNameVersionFromPatch } from "../../lib/providers";

function extractPatchPathsFromTargetsAuto(output: string): string[] {
  const m = output.match(/patch_paths=\[([^\]]*)\]/);
  if (!m) return [];
  const inner = (m[1] || "").trim();
  if (!inner) return [];
  return inner
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/^"+/, "").replace(/"+$/, ""));
}

test("provider-sync-driver patch inclusion policy: Node includes all importer-local patches; Python filters to effective set", async () => {
  await runInTemp("provider-sync-driver.patch-policy", async (tmp, $) => {
    const prevCwd = process.cwd();
    const prevWorkspaceRoot = process.env.WORKSPACE_ROOT;
    try {
      // The provider sync driver and writer use process.env.WORKSPACE_ROOT and/or process.cwd()
      // to resolve relative output paths. In runInTemp we must set these explicitly when invoking
      // the driver directly (as opposed to spawning a subprocess via the provided `$` helper).
      process.env.WORKSPACE_ROOT = tmp;
      process.chdir(tmp);
      await $`git init`;

      await fsp.mkdir(path.join(tmp, "third_party/providers"), { recursive: true });

      const importer = "apps/demo";
      const onlyEffective = "aaa@1.0.0.patch";
      const notEffective = "zzz@9.9.9.patch";

      const nodePatchDir = path.join(tmp, importer, "patches/node");
      await fsp.mkdir(nodePatchDir, { recursive: true });
      await fsp.writeFile(path.join(nodePatchDir, onlyEffective), "# test\n", "utf8");
      await fsp.writeFile(path.join(nodePatchDir, notEffective), "# test\n", "utf8");

      const pythonPatchDir = path.join(tmp, importer, "patches/python");
      await fsp.mkdir(pythonPatchDir, { recursive: true });
      await fsp.writeFile(path.join(pythonPatchDir, onlyEffective), "# test\n", "utf8");
      await fsp.writeFile(path.join(pythonPatchDir, notEffective), "# test\n", "utf8");

      const eff = new Set<string>(["aaa@1.0.0"]);

      const baseOpts = {
        discoverLockfiles: async () => [`${importer}/pnpm-lock.yaml`],
        parseEffectiveSetForLockfile: async () => new Map([[importer, eff]]),
        decodePatchKey: decodeNameVersionFromPatch,
      } as const;

      await runImporterProviderSync({
        ...baseOpts,
        lang: "node",
        listImporterPatchesFor: async (imp: string) => listImporterPatches(imp, "node"),
        importerPatchInclusionPolicy: "all",
        outFile: "third_party/providers/TARGETS.node.auto",
      });

      await runImporterProviderSync({
        ...baseOpts,
        lang: "python",
        listImporterPatchesFor: async (imp: string) => listImporterPatches(imp, "python"),
        importerPatchInclusionPolicy: "effective-set-only",
        outFile: "third_party/providers/TARGETS.python.auto",
      });

      const nodeOut = await fsp.readFile(
        path.join(tmp, "third_party/providers/TARGETS.node.auto"),
        "utf8",
      );
      const pythonOut = await fsp.readFile(
        path.join(tmp, "third_party/providers/TARGETS.python.auto"),
        "utf8",
      );

      const nodePatchPaths = extractPatchPathsFromTargetsAuto(nodeOut);
      const pythonPatchPaths = extractPatchPathsFromTargetsAuto(pythonOut);

      const expectedNode = [
        `${importer}/patches/node/${onlyEffective}`,
        `${importer}/patches/node/${notEffective}`,
      ];
      const expectedPython = [`${importer}/patches/python/${onlyEffective}`];

      for (const p of expectedNode) {
        if (!nodePatchPaths.includes(p)) {
          console.error("Expected Node provider to include importer-local patch path:", p);
          console.error("Got:", nodePatchPaths);
          process.exit(2);
        }
      }
      for (const p of [`${importer}/patches/python/${notEffective}`]) {
        if (pythonPatchPaths.includes(p)) {
          console.error(
            "Expected Python provider to exclude non-effective importer-local patch path:",
            p,
          );
          console.error("Got:", pythonPatchPaths);
          process.exit(2);
        }
      }
      for (const p of expectedPython) {
        if (!pythonPatchPaths.includes(p)) {
          console.error(
            "Expected Python provider to include effective importer-local patch path:",
            p,
          );
          console.error("Got:", pythonPatchPaths);
          process.exit(2);
        }
      }
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
