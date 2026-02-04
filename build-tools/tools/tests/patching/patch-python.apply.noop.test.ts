#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("patch-python apply is no-op when no changes", async () => {
  await runInTemp("patch-python-apply-noop", async (tmp, $) => {
    const importer = path.join(tmp, "apps", "pytool");
    await fs.mkdirp(importer);
    const uvLock = ["# uv lock", "[[package]]", 'name = "requests"', 'version = "2.32.3"', ""].join(
      "\n",
    );
    await fs.writeFile(path.join(importer, "uv.lock"), uvLock, "utf8");

    const origin = path.join(tmp, "pycache", "requests-2.32.3");
    await fs.mkdirp(origin);
    await fs.writeFile(path.join(origin, "readme.txt"), "hello\n", "utf8");

    await $`chmod +x build-tools/tools/bin/patch-pkg`;
    await $({
      cwd: tmp,
    })`WORKSPACE_ROOT=${tmp} NIX_PY_TEST_RESOLVE_JSON=${JSON.stringify({
      requests: { version: "2.32.3", originPath: origin },
    })} NIX_PY_DEV_OVERRIDE_JSON={} build-tools/tools/bin/patch-pkg start python requests --importer ${importer}`;

    const out = await $({
      cwd: tmp,
    })`WORKSPACE_ROOT=${tmp} NIX_PY_TEST_RESOLVE_JSON=${JSON.stringify({
      requests: { version: "2.32.3", originPath: origin },
    })} NIX_PY_DEV_OVERRIDE_JSON={} build-tools/tools/bin/patch-pkg apply python requests --importer ${importer}`;
    const all = String(out.stdout || "") + String(out.stderr || "");
    if (!all.includes("no changes; no-op (cleared dev overrides and ended session)")) {
      console.error("apply did not report no-op");
      console.error("--- captured output ---\n" + all + "\n--- end ---");
      process.exit(2);
    }
    const patch = path.join(importer, "patches", "python", "requests@2.32.3.patch");
    if (await fs.pathExists(patch)) {
      console.error("unexpected python patch file created for no-op apply");
      process.exit(2);
    }
  });
});
