#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("patch-cpp start with PATCH_ECHO_SNIPPET prints unified export snippet", async () => {
  await runInTemp("patch-cpp-start-global-echo", async (tmp, $) => {
    const storeSrc = path.join(tmp, "nix-store", "zlib-src");
    await fsp.mkdir(storeSrc, { recursive: true });
    await fsp.writeFile(path.join(storeSrc, "file.txt"), "A\n", "utf8");
    const attr = "pkgs.zlib";
    const version = "1.2.13";
    const map = { [attr]: { version, srcPath: storeSrc, pname: "zlib" } };
    await $`chmod +x viberoots/build-tools/tools/bin/patch-pkg`;
    const out = await $({
      cwd: tmp,
      stdio: "pipe",
    })`PATCH_ECHO_SNIPPET=1 NIX_CPP_TEST_RESOLVE_JSON=${JSON.stringify(map)} viberoots/build-tools/tools/bin/patch-pkg start cpp ${attr}`;
    const ws = String(out.stdout || "")
      .trim()
      .split(/\s+/)
      .pop() as string;
    const expected =
      "\nTo build using this workspace as a dev override (local only), run:\n" +
      `export NIX_CPP_DEV_OVERRIDE_JSON='${JSON.stringify({ [attr]: ws })}'` +
      "\n\nUnset before CI: unset NIX_CPP_DEV_OVERRIDE_JSON\n";
    const err = String(out.stderr || "");
    if (!err.includes(expected)) {
      console.error("expected exact export snippet in stderr");
      console.error("----- expected -----\n" + expected);
      console.error("----- stderr -----\n" + err);
      process.exit(2);
    }
  });
});
