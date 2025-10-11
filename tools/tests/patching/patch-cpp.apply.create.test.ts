#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("patch-cpp apply writes patch and prints overlay snippet", async () => {
  await runInTemp("patch-cpp-apply-create", async (tmp, $) => {
    const storeSrc = path.join(tmp, "nix-store", "zlib-src");
    await fs.mkdirp(storeSrc);
    await fs.outputFile(path.join(storeSrc, "file.txt"), "A\n", "utf8");
    const map = { "pkgs.zlib": { version: "1.2.13", srcPath: storeSrc, pname: "zlib" } };

    await $`chmod +x tools/bin/patch-pkg`;
    const wsOut = await $({ cwd: tmp })`NIX_CPP_TEST_RESOLVE_JSON=${JSON.stringify(
      map,
    )} tools/bin/patch-pkg start cpp pkgs.zlib`;
    const ws = String(wsOut.stdout).trim().split(/\s+/).pop() as string;
    await fs.outputFile(path.join(ws, "file.txt"), "B\n", "utf8");

    const out = await $({ cwd: tmp })`NIX_CPP_TEST_RESOLVE_JSON=${JSON.stringify(
      map,
    )} tools/bin/patch-pkg apply cpp zlib`;

    const patch = path.join(tmp, "patches/cpp", "pkgs_zlib@1.2.13.patch");
    if (!(await fs.pathExists(patch))) {
      console.error("expected cpp patch file missing");
      process.exit(2);
    }

    const txt = String(out.stdout || "");
    if (!txt.includes("Overlay snippet")) {
      console.error("expected overlay snippet in stdout");
      process.exit(2);
    }
  });
});
