#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("patch-cpp start creates session and workspace (idempotent)", async () => {
  await runInTemp("patch-cpp-start", async (tmp, $) => {
    const storeSrc = path.join(tmp, "nix-store", "zlib-src");
    await fs.mkdirp(storeSrc);
    await fs.outputFile(path.join(storeSrc, "README"), "zlib\n", "utf8");

    const map = { "pkgs.zlib": { version: "1.2.13", srcPath: storeSrc, pname: "zlib" } };

    await $`chmod +x viberoots/build-tools/tools/bin/patch-pkg`;

    const r1 = await $({ cwd: tmp })`NIX_CPP_TEST_RESOLVE_JSON=${JSON.stringify(
      map,
    )} viberoots/build-tools/tools/bin/patch-pkg start cpp pkgs.zlib`;
    const ws1 = String(r1.stdout || "")
      .trim()
      .split(/\s+/)
      .pop() as string;
    if (!ws1) {
      console.error("missing workspace path in stdout");
      process.exit(2);
    }

    // Session file exists
    const storePath = path.join(tmp, ".patch-sessions.json");
    const st = JSON.parse(await fs.readFile(storePath, "utf8"));
    if (!st?.sessions?.cpp?.["pkgs.zlib@1.2.13"]) {
      console.error("session record missing for pkgs.zlib@1.2.13");
      process.exit(2);
    }

    // Idempotent start returns same workspace
    const r2 = await $({ cwd: tmp })`NIX_CPP_TEST_RESOLVE_JSON=${JSON.stringify(
      map,
    )} viberoots/build-tools/tools/bin/patch-pkg start cpp zlib`;
    const ws2 = String(r2.stdout || "")
      .trim()
      .split(/\s+/)
      .pop() as string;
    if (ws2 !== ws1) {
      console.error("idempotent start returned different workspace path");
      process.exit(2);
    }
  });
});
