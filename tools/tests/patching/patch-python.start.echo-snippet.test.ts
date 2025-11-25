#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("patch-python start --echo-snippet prints an export snippet", async () => {
  await runInTemp("patch-python-start-echo-snippet", async (tmp, $) => {
    const importer = path.join(tmp, "apps", "pytool");
    await fs.mkdirp(importer);
    const uvLock = ["# uv lock", "[[package]]", 'name = "requests"', 'version = "2.32.3"', ""].join(
      "\n",
    );
    await fs.writeFile(path.join(importer, "uv.lock"), uvLock, "utf8");
    const origin = path.join(tmp, "pycache", "requests-2.32.3");
    await fs.mkdirp(origin);
    await fs.writeFile(path.join(origin, "readme.txt"), "A\n", "utf8");
    await $`chmod +x tools/bin/patch-pkg`;
    const out = await $({
      cwd: tmp,
      stdio: "pipe",
    })`NIX_PY_TEST_RESOLVE_JSON=${JSON.stringify({
      requests: { version: "2.32.3", originPath: origin },
    })} NIX_PY_DEV_OVERRIDE_JSON={} tools/bin/patch-pkg start python requests --importer ${importer} --echo-snippet`;
    const full = [String(out.stdout || ""), String(out.stderr || "")].join("\n");
    if (!full.includes("export NIX_PY_DEV_OVERRIDE_JSON=")) {
      console.error("expected export snippet in output");
      console.error("--- output start ---\n" + full + "\n--- output end ---");
      process.exit(2);
    }
  });
});
