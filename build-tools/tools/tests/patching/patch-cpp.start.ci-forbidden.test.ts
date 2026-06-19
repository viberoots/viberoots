#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("patch-cpp start fails in CI when attempting to set dev overrides", async () => {
  await runInTemp("patch-cpp-start-ci-forbidden", async (tmp, $) => {
    const storeSrc = path.join(tmp, "nix-store", "zlib-src");
    await fsp.mkdir(storeSrc, { recursive: true });
    await fsp.writeFile(path.join(storeSrc, "README"), "zlib\n", "utf8");
    const map = { "pkgs.zlib": { version: "1.2.13", srcPath: storeSrc, pname: "zlib" } };
    await $`chmod +x viberoots/build-tools/tools/bin/patch-pkg`;
    const r = await $({
      cwd: tmp,
      stdio: "pipe",
    })`CI=true NIX_CPP_TEST_RESOLVE_JSON=${JSON.stringify(
      map,
    )} viberoots/build-tools/tools/bin/patch-pkg start cpp pkgs.zlib`.nothrow();
    if ((r.exitCode || 0) === 0) {
      console.error("expected patch-cpp start to fail in CI when setting dev overrides");
      console.error("stdout:", String(r.stdout || ""));
      console.error("stderr:", String(r.stderr || ""));
      process.exit(2);
    }
  });
});
