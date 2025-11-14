#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("PATCH_PKG_DEBUG enables debug output for patch-go", async () => {
  await runInTemp("patch-go-debug-pkg-flag", async (tmp, $) => {
    const origin = path.join(tmp, "gomodcache", "example.com/foo@v1.0.0");
    await fsp.mkdir(origin, { recursive: true });
    await fsp.writeFile(path.join(origin, "README.md"), "hello\n", "utf8");
    const map = { "example.com/foo": { version: "v1.0.0", originPath: origin } };

    await $`chmod +x tools/bin/patch-pkg`;
    const out = await $({
      cwd: tmp,
      stdio: "pipe",
    })`WORKSPACE_ROOT=${tmp} PATCH_PKG_DEBUG=1 NIX_GO_TEST_RESOLVE_JSON=${JSON.stringify(
      map,
    )} NIX_GO_DEV_OVERRIDE_JSON={} GOMODCACHE=${path.join(
      tmp,
      "gomodcache",
    )} tools/bin/patch-pkg start go example.com/foo`;
    const all = String(out.stdout || "") + String(out.stderr || "");
    if (!all.includes("[patch-go][debug]")) {
      console.error("expected debug output missing with PATCH_PKG_DEBUG=1");
      console.error("--- captured output start ---\n" + all + "\n--- captured output end ---");
      process.exit(2);
    }
  });
});
