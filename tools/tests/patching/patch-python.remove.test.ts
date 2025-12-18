#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("patch-python remove drops patch and refreshes glue deterministically", async () => {
  await runInTemp("patch-python-remove", async (tmp, $) => {
    // Create a minimal Python importer with uv.lock
    const importer = path.join(tmp, "apps", "pytool");
    await fs.mkdirp(importer);
    const uvLock = ["# uv lock", "[[package]]", 'name = "requests"', 'version = "2.32.3"', ""].join(
      "\n",
    );
    await fs.writeFile(path.join(importer, "uv.lock"), uvLock, "utf8");

    // Provide a test resolve mapping for requests@2.32.3 (origin not used by remove, but required by resolver)
    const origin = path.join(tmp, "pycache", "requests-2.32.3");
    await fs.mkdirp(origin);
    await fs.writeFile(path.join(origin, "readme.txt"), "A\n", "utf8");

    // Seed an importer-local patch file to remove
    const patchDir = path.join(importer, "patches", "python");
    await fs.mkdirp(patchDir);
    const patch = path.join(patchDir, "requests@2.32.3.patch");
    await fs.writeFile(patch, "--- a/readme.txt\n+++ b/readme.txt\n", "utf8");

    await $`chmod +x tools/bin/patch-pkg`;

    // Remove should delete the patch and invoke glue (creating providers auto outputs)
    await $({
      cwd: tmp,
    })`WORKSPACE_ROOT=${tmp} NIX_PY_TEST_RESOLVE_JSON=${JSON.stringify({
      requests: { version: "2.32.3", originPath: origin },
    })} NIX_PY_DEV_OVERRIDE_JSON={} tools/bin/patch-pkg remove python requests --importer ${importer}`;

    if (await fs.pathExists(patch)) {
      console.error("expected python patch file to be removed:", patch);
      process.exit(2);
    }

    const auto = path.join(tmp, "third_party", "providers", "TARGETS.python.auto");
    if (!(await fs.pathExists(auto))) {
      console.error("expected providers auto file missing:", auto);
      process.exit(2);
    }
    const txt = await fs.readFile(auto, "utf8");
    if (
      !txt.includes('lockfile="apps/pytool/uv.lock"') ||
      !txt.includes('importer="apps/pytool"')
    ) {
      console.error("providers file missing expected importer entries");
      process.exit(2);
    }
    if (txt.includes("apps/pytool/patches/python/requests@2.32.3.patch")) {
      console.error("providers file still references removed patch");
      process.exit(2);
    }

    const autoMap = path.join(tmp, "third_party", "providers", "auto_map.bzl");
    const beforeMap = (await fs.pathExists(autoMap)) ? await fs.readFile(autoMap, "utf8") : "";
    const beforeTargets = await fs.readFile(auto, "utf8");

    // Idempotency: a second remove should be a no-op and leave outputs stable
    await $({
      cwd: tmp,
    })`WORKSPACE_ROOT=${tmp} NIX_PY_TEST_RESOLVE_JSON=${JSON.stringify({
      requests: { version: "2.32.3", originPath: origin },
    })} NIX_PY_DEV_OVERRIDE_JSON={} tools/bin/patch-pkg remove python requests --importer ${importer}`;

    const afterTargets = await fs.readFile(auto, "utf8");
    const afterMap = (await fs.pathExists(autoMap)) ? await fs.readFile(autoMap, "utf8") : "";
    if (beforeTargets !== afterTargets || beforeMap !== afterMap) {
      console.error("glue outputs changed on idempotent python remove");
      process.exit(2);
    }
  });
});
