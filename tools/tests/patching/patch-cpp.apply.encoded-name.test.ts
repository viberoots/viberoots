#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("patch-cpp apply uses double-underscore encoding for attr path", async () => {
  await runInTemp("patch-cpp-apply-encoded", async (tmp, $) => {
    const storeSrc = path.join(tmp, "nix-store", "openssl-src");
    await fs.mkdirp(storeSrc);
    await fs.outputFile(path.join(storeSrc, "file.txt"), "A\n", "utf8");
    const map = { "pkgs.openssl": { version: "3.3.1", srcPath: storeSrc, pname: "openssl" } };

    await $`chmod +x tools/bin/patch-pkg`;
    const wsOut = await $({ cwd: tmp })`NIX_CPP_TEST_RESOLVE_JSON=${JSON.stringify(
      map,
    )} tools/bin/patch-pkg start cpp pkgs.openssl`;
    const ws = String(wsOut.stdout).trim().split(/\s+/).pop() as string;
    await fs.outputFile(path.join(ws, "file.txt"), "B\n", "utf8");

    const out = await $({ cwd: tmp })`NIX_CPP_TEST_RESOLVE_JSON=${JSON.stringify(
      map,
    )} tools/bin/patch-pkg apply cpp openssl`;

    const patch = path.join(tmp, "patches/cpp", "pkgs__openssl@3.3.1.patch");
    if (!(await fs.pathExists(patch))) {
      console.error("expected encoded cpp patch filename pkgs__openssl@3.3.1.patch");
      process.exit(2);
    }

    const txt = String(out.stdout || "").toLowerCase();
    if (!txt.includes("auto-discovers patches")) {
      console.error("expected auto-discovery note in stdout");
      process.exit(2);
    }
  });
});
