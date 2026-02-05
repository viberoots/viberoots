#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("sync-providers-python: deterministic generation and idempotency with patch filter", async () => {
  await runInTemp("sync-python-idem", async (tmp, $) => {
    const importer = path.join(tmp, "projects", "apps", "pytool");
    await fsp.mkdir(importer, { recursive: true });
    // Minimal uv.lock with two packages; only one has a matching patch
    const uvLock = [
      "# uv lock",
      "[[package]]",
      'name = "requests"',
      'version = "2.32.3"',
      "",
      "[[package]]",
      'name = "urllib3"',
      'version = "2.2.3"',
      "",
    ].join("\n");
    await fsp.writeFile(path.join(importer, "uv.lock"), uvLock, "utf8");

    // Move to importer-local patches directory
    const importerPatches = path.join(importer, "patches", "python");
    await fsp.mkdir(importerPatches, { recursive: true });
    // Matching patch (importer-local)
    await fsp.writeFile(path.join(importerPatches, "requests@2.32.3.patch"), "# patch\n", "utf8");
    // Unused patch (must not be included in patch_paths)
    await fsp.writeFile(path.join(importerPatches, "unused@1.0.0.patch"), "# patch\n", "utf8");

    // Run orchestrator for python
    await $`node build-tools/tools/buck/sync-providers.ts --lang python`;
    const outPath = path.join(tmp, "third_party", "providers", "TARGETS.python.auto");
    const text1 = await fsp.readFile(outPath, "utf8");

    // Expectations:
    // - Contains python_importer_deps for projects/apps/pytool/uv.lock and importer "projects/apps/pytool"
    // - patch_paths includes only the matching requests patch, not unused
    if (!text1.includes("python_importer_deps(")) {
      console.error("missing python_importer_deps entry");
      process.exit(2);
    }
    if (
      !text1.includes('lockfile="projects/apps/pytool/uv.lock"') ||
      !text1.includes('importer="projects/apps/pytool"')
    ) {
      console.error("lockfile/importer fields incorrect");
      process.exit(2);
    }
    if (!text1.includes("projects/apps/pytool/patches/python/requests@2.32.3.patch")) {
      console.error("expected matching patch to be included in patch_paths");
      process.exit(2);
    }
    if (text1.includes("projects/apps/pytool/patches/python/unused@1.0.0.patch")) {
      console.error("unexpected unused patch included in patch_paths");
      process.exit(2);
    }

    // Idempotency: rerun and file content should remain identical
    await $`node build-tools/tools/buck/sync-providers.ts --lang python`;
    const text2 = await fsp.readFile(outPath, "utf8");
    if (text1 !== text2) {
      console.error("file changed on second run (should be no-op)");
      process.exit(2);
    }

    // Ensure the curated TARGETS file gained the AUTO_PYTHON section
    const curated = await fsp.readFile(
      path.join(tmp, "third_party", "providers", "TARGETS"),
      "utf8",
    );
    if (!curated.includes("# BEGIN AUTO_PYTHON") || !curated.includes("# END AUTO_PYTHON")) {
      console.error("expected AUTO_PYTHON managed section not found in curated TARGETS");
      process.exit(2);
    }
  });
});
