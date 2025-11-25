#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("patch-python start with PATCH_ECHO_SNIPPET prints unified export snippet", async () => {
  await runInTemp("patch-python-start-global-echo", async (tmp, $) => {
    // Create importer with uv.lock
    const importer = path.join(tmp, "apps", "pytool");
    await fs.mkdirp(importer);
    const uvLock = ["# uv lock", "[[package]]", 'name = "requests"', 'version = "2.32.3"', ""].join(
      "\n",
    );
    await fs.writeFile(path.join(importer, "uv.lock"), uvLock, "utf8");
    // Fake pristine cache
    const origin = path.join(tmp, "pycache", "requests-2.32.3");
    await fs.mkdirp(origin);
    await fs.writeFile(path.join(origin, "readme.txt"), "A\n", "utf8");
    await $`chmod +x tools/bin/patch-pkg`;
    const res = await $({
      cwd: tmp,
      stdio: "pipe",
    })`PATCH_ECHO_SNIPPET=1 NIX_PY_TEST_RESOLVE_JSON=${JSON.stringify({
      requests: { version: "2.32.3", originPath: origin },
    })} NIX_PY_DEV_OVERRIDE_JSON={} tools/bin/patch-pkg start python requests --importer ${importer}`;
    const ws = String(res.stdout || "")
      .trim()
      .split(/\s+/)
      .pop() as string;
    const expected =
      "\nTo build using this workspace as a dev override (local only), run:\n" +
      `export NIX_PY_DEV_OVERRIDE_JSON='${JSON.stringify({
        "requests@2.32.3": ws,
      })}'` +
      "\n\nUnset before CI: unset NIX_PY_DEV_OVERRIDE_JSON\n";
    const err = String(res.stderr || "");
    if (!err.includes(expected)) {
      console.error("expected exact export snippet in stderr");
      console.error("----- expected -----\n" + expected);
      console.error("----- stderr -----\n" + err);
      process.exit(2);
    }
  });
});
