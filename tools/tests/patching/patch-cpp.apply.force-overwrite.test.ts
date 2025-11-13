#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("patch-cpp apply supports --force overwrite when patch exists with different content", async () => {
  await runInTemp("patch-cpp-apply-force", async (tmp, $) => {
    const storeSrc = path.join(tmp, "nix-store", "zlib-src");
    await fs.mkdirp(storeSrc);
    await fs.writeFile(path.join(storeSrc, "file.txt"), "A\n", "utf8");
    const resolveMap = { "pkgs.zlib": { version: "1.2.13", srcPath: storeSrc, pname: "zlib" } };

    await $`chmod +x tools/bin/patch-pkg`;
    // Start session and capture workspace + originPath from session store
    const startOut = await $({
      cwd: tmp,
      stdio: "pipe",
    })`WORKSPACE_ROOT=${tmp} NIX_CPP_TEST_RESOLVE_JSON=${JSON.stringify(
      resolveMap,
    )} tools/bin/patch-pkg start cpp pkgs.zlib`;
    const ws = String(startOut.stdout || "")
      .trim()
      .split(/\s+/)
      .pop() as string;
    if (!ws) {
      console.error("missing workspace path from start");
      process.exit(2);
    }
    const store = JSON.parse(
      await fs.readFile(path.join(tmp, ".patch-sessions.json"), "utf8"),
    ) as any;
    const rec = store.sessions?.cpp?.["pkgs.zlib@1.2.13"];
    if (!rec?.originPath) {
      console.error("missing originPath in cpp session store");
      process.exit(2);
    }
    const originPath = rec.originPath as string;

    // First change A -> B and apply to create initial patch
    await fs.remove(path.join(tmp, "patches", "cpp")).catch(() => {});
    await fsp.writeFile(path.join(ws, "file.txt"), "B\n", "utf8");
    const apply1 = await $({
      cwd: tmp,
      stdio: "pipe",
    })`WORKSPACE_ROOT=${tmp} NIX_CPP_TEST_RESOLVE_JSON=${JSON.stringify(
      resolveMap,
    )} tools/bin/patch-pkg apply cpp pkgs.zlib --patch-dir patches/cpp`;
    if ((apply1.exitCode || 0) !== 0) {
      console.error("initial cpp apply failed:", String(apply1.stderr || ""));
      process.exit(2);
    }
    const patchPath = path.join(tmp, "patches", "cpp", "pkgs__zlib@1.2.13.patch");
    const first = await fs.readFile(patchPath, "utf8");
    if (!first.includes("+B")) {
      console.error("initial cpp patch content did not include expected change to 'B'");
      process.exit(2);
    }

    // Modify workspace again A -> C; re-seed session to point to existing workspace
    await fsp.writeFile(path.join(ws, "file.txt"), "C\n", "utf8");
    const newStore = {
      version: 1,
      sessions: {
        cpp: {
          "pkgs.zlib@1.2.13": {
            importPath: "pkgs.zlib",
            version: "1.2.13",
            originPath,
            workspacePath: ws,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        },
      },
    };
    await fs.writeFile(
      path.join(tmp, ".patch-sessions.json"),
      JSON.stringify(newStore, null, 2) + "\n",
      "utf8",
    );

    // Apply without --force: should fail due to existing different patch
    const applyNoForce = await $({
      cwd: tmp,
      stdio: "pipe",
    })`WORKSPACE_ROOT=${tmp} NIX_CPP_TEST_RESOLVE_JSON=${JSON.stringify(
      resolveMap,
    )} tools/bin/patch-pkg apply cpp pkgs.zlib --patch-dir patches/cpp`.nothrow();
    if ((applyNoForce.exitCode || 0) === 0) {
      console.error("cpp apply without --force should have failed");
      process.exit(2);
    }
    const errTxt = String(applyNoForce.stdout || "") + String(applyNoForce.stderr || "");
    if (!/exists with different content/i.test(errTxt)) {
      console.error("expected overwrite guidance when cpp patch differs");
      process.exit(2);
    }

    // Apply with --force: should overwrite and verify via dry-run
    const applyForce = await $({
      cwd: tmp,
      stdio: "pipe",
    })`WORKSPACE_ROOT=${tmp} NIX_CPP_TEST_RESOLVE_JSON=${JSON.stringify(
      resolveMap,
    )} tools/bin/patch-pkg apply cpp pkgs.zlib --patch-dir patches/cpp --force`;
    if ((applyForce.exitCode || 0) !== 0) {
      console.error("cpp apply with --force should have succeeded");
      console.error(String(applyForce.stderr || ""));
      process.exit(2);
    }
    const second = await fs.readFile(patchPath, "utf8");
    if (second === first || !second.includes("+C")) {
      console.error("expected cpp patch file to be overwritten with new content including '+C'");
      process.exit(2);
    }
  });
});
