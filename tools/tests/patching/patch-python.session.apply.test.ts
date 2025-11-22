#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("patch-python session applies on Ctrl-D and clears session", async () => {
  await runInTemp("patch-python-session-apply", async (tmp, $) => {
    const zxInit = path.join(process.cwd(), "tools", "dev", "zx-init.mjs");
    // Minimal importer with uv.lock and a resolvable distribution
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

    // Start a session to get a workspace (invoke TS entrypoint directly to avoid shell wrapper env requirements)
    const wsOut = await $({
      cwd: tmp,
    })`NIX_PY_TEST_RESOLVE_JSON=${JSON.stringify({
      requests: { version: "2.32.3", originPath: origin },
    })} NIX_PY_DEV_OVERRIDE_JSON={} ${process.execPath} --experimental-strip-types --import ${zxInit} tools/patch/patch-pkg.ts start python requests --importer ${importer}`;
    const ws = String(wsOut.stdout || "")
      .trim()
      .split(/\s+/)
      .pop() as string;

    // Modify workspace content to ensure a diff exists
    await fs.writeFile(path.join(ws, "readme.txt"), "B\n", "utf8");

    // Apply non-interactively (session equivalence for test): call apply and skip external patch verification
    await $({
      cwd: tmp,
      env: {
        ...process.env,
        WORKSPACE_ROOT: tmp,
        NIX_PY_TEST_RESOLVE_JSON: JSON.stringify({
          requests: { version: "2.32.3", originPath: origin },
        }),
        NIX_PY_DEV_OVERRIDE_JSON: "{}",
        PATCH_SKIP_VERIFY: "1",
      },
    })`${process.execPath} --experimental-strip-types --import ${zxInit} tools/patch/patch-pkg.ts apply python requests --importer ${importer}`;

    // Patch file must be created under the importer-local patches directory
    const patch = path.join(importer, "patches", "python", "requests@2.32.3.patch");
    if (!(await fs.pathExists(patch))) {
      console.error("expected patch file missing:", patch);
      process.exit(2);
    }
    // Session store should be cleared for python/requests@2.32.3
    const storePath = path.join(tmp, ".patch-sessions.json");
    const txt = (await fs.pathExists(storePath)) ? await fs.readFile(storePath, "utf8") : "{}";
    const obj = JSON.parse(txt || "{}");
    const sessions = (obj?.sessions?.python as Record<string, any>) || {};
    if ("requests@2.32.3" in sessions) {
      console.error("expected session to be cleared after apply");
      process.exit(2);
    }
  });
});
