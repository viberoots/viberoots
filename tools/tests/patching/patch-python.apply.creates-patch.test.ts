#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("patch-python apply writes canonical patch and refreshes glue", async () => {
  await runInTemp("patch-python-apply", async (tmp, $) => {
    // Create a minimal Python importer with uv.lock
    const importer = path.join(tmp, "apps", "pytool");
    await fs.mkdirp(importer);
    const uvLock = ["# uv lock", "[[package]]", 'name = "requests"', 'version = "2.32.3"', ""].join(
      "\n",
    );
    await fs.writeFile(path.join(importer, "uv.lock"), uvLock, "utf8");

    // Provide a pristine source for requests@2.32.3 in a fake cache
    const origin = path.join(tmp, "pycache", "requests-2.32.3");
    await fs.mkdirp(origin);
    await fs.writeFile(path.join(origin, "readme.txt"), "A\n", "utf8");

    // Start a Python patch session
    await $`chmod +x tools/bin/patch-pkg`;
    const wsOut = await $({
      cwd: tmp,
    })`NIX_PY_TEST_RESOLVE_JSON=${JSON.stringify({
      requests: { version: "2.32.3", originPath: origin },
    })} NIX_PY_DEV_OVERRIDE_JSON={} tools/bin/patch-pkg start python requests --importer ${importer}`;
    const ws = String(wsOut.stdout || "")
      .trim()
      .split(/\s+/)
      .pop() as string;
    // Edit a file to produce a diff
    await fs.writeFile(path.join(ws, "readme.txt"), "B\n", "utf8");

    // Apply patch (importer-local directory for Python)
    await $({
      cwd: tmp,
    })`NIX_PY_TEST_RESOLVE_JSON=${JSON.stringify({
      requests: { version: "2.32.3", originPath: origin },
    })} NIX_PY_DEV_OVERRIDE_JSON={} tools/bin/patch-pkg apply python requests --importer ${importer}`;

    const patch = path.join(importer, "patches", "python", "requests@2.32.3.patch");
    if (!(await fs.pathExists(patch))) {
      console.error("expected patch file missing:", patch);
      process.exit(2);
    }
    // Glue refresh should create TARGETS.python.auto with importer entry and our patch
    const auto = path.join(tmp, "third_party", "providers", "TARGETS.python.auto");
    const ok = await fs.pathExists(auto);
    if (!ok) {
      console.error("expected providers auto file missing:", auto);
      process.exit(2);
    }
    const txt = await fs.readFile(auto, "utf8");
    if (
      !txt.includes('lockfile="apps/pytool/uv.lock"') ||
      !txt.includes('importer="apps/pytool"') ||
      !txt.includes("apps/pytool/patches/python/requests@2.32.3.patch")
    ) {
      console.error("providers file missing expected importer or patch entries");
      process.exit(2);
    }
  });
});
