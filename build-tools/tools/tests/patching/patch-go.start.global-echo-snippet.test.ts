#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("patch-go start with PATCH_ECHO_SNIPPET prints unified export snippet", async () => {
  await runInTemp("patch-go-start-global-echo", async (tmp, $) => {
    const origin = path.join(tmp, "gomodcache", "golang.org/x/net@v0.24.0");
    await fsp.mkdir(origin, { recursive: true });
    await fsp.writeFile(path.join(origin, "README.md"), "hello\n", "utf8");
    const importPath = "golang.org/x/net";
    const version = "v0.24.0";
    const map = { [importPath]: { version, originPath: origin } };
    await $`chmod +x viberoots/build-tools/tools/bin/patch-pkg`;
    const res = await $({
      cwd: tmp,
      stdio: "pipe",
    })`PATCH_ECHO_SNIPPET=1 NIX_GO_TEST_RESOLVE_JSON=${JSON.stringify(
      map,
    )} NIX_GO_DEV_OVERRIDE_JSON={} viberoots/build-tools/tools/bin/patch-pkg start go ${importPath}`;
    const ws = String(res.stdout || "")
      .trim()
      .split(/\s+/)
      .pop() as string;
    const expected =
      "\nTo build using this workspace as a dev override (local only), run:\n" +
      `export NIX_GO_DEV_OVERRIDE_JSON='${JSON.stringify({
        [`${importPath}@${version}`]: ws,
      })}'` +
      "\n\nUnset before CI: unset NIX_GO_DEV_OVERRIDE_JSON\n";
    const err = String(res.stderr || "");
    if (!err.includes(expected)) {
      console.error("expected exact export snippet in stderr");
      console.error("----- expected -----\n" + expected);
      console.error("----- stderr -----\n" + err);
      process.exit(2);
    }
  });
});
