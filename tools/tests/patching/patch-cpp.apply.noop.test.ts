#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("patch-cpp apply is no-op when no changes", async () => {
  await runInTemp("patch-cpp-apply-noop", async (tmp, $) => {
    const storeSrc = path.join(tmp, "nix-store", "zlib-src");
    await fs.mkdirp(storeSrc);
    await fs.outputFile(path.join(storeSrc, "README"), "zlib\n", "utf8");
    const map = { "pkgs.zlib": { version: "1.2.13", srcPath: storeSrc, pname: "zlib" } };

    await $`chmod +x tools/bin/patch-pkg`;
    await $({ cwd: tmp })`NIX_CPP_TEST_RESOLVE_JSON=${JSON.stringify(
      map,
    )} tools/bin/patch-pkg start cpp zlib`;

    const out = await $({ cwd: tmp })`NIX_CPP_TEST_RESOLVE_JSON=${JSON.stringify(
      map,
    )} tools/bin/patch-pkg apply cpp pkgs.zlib`;
    if (!String(out.stdout).includes("no changes; no-op")) {
      console.error("apply did not report no-op");
      process.exit(2);
    }
    const patch = path.join(tmp, "patches/cpp", "pkgs_zlib@1.2.13.patch");
    if (await fs.pathExists(patch)) {
      console.error("unexpected cpp patch file created for no-op apply");
      process.exit(2);
    }
  });
});
