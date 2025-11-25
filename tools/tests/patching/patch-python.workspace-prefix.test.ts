#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("patch-python: workspace parent dir is bucknix-patch-python", async () => {
  await runInTemp("patch-python-ws-prefix", async (tmp, $) => {
    // Minimal Python importer with uv.lock
    const importer = path.join(tmp, "apps", "pytool");
    await fsp.mkdir(importer, { recursive: true });
    const uvLock = ["# uv lock", "[[package]]", 'name = "requests"', 'version = "2.32.3"', ""].join(
      "\n",
    );
    await fsp.writeFile(path.join(importer, "uv.lock"), uvLock, "utf8");

    // Provide pristine source for requests@2.32.3
    const origin = path.join(tmp, "pycache", "requests-2.32.3");
    await fsp.mkdir(origin, { recursive: true });
    await fsp.writeFile(path.join(origin, "readme.txt"), "A\n", "utf8");

    await $`chmod +x tools/bin/patch-pkg`;
    const out = await $({
      cwd: tmp,
    })`NIX_PY_TEST_RESOLVE_JSON=${JSON.stringify({
      requests: { version: "2.32.3", originPath: origin },
    })} NIX_PY_DEV_OVERRIDE_JSON={} tools/bin/patch-pkg start python requests --importer ${importer}`;
    const ws = String(out.stdout || "")
      .trim()
      .split(/\s+/)
      .pop() as string;
    if (!ws) {
      console.error("missing workspace path on stdout");
      process.exit(2);
    }
    const parent = path.basename(path.dirname(ws));
    if (parent !== "bucknix-patch-python") {
      console.error("unexpected workspace parent dir", { parent, ws });
      process.exit(2);
    }
  });
});
