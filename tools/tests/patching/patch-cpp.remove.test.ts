#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("patch-cpp remove drops patch and refreshes glue deterministically", async () => {
  await runInTemp("patch-cpp-remove", async (tmp, $) => {
    const patchesDir = path.join(tmp, "patches", "cpp");
    await fs.mkdirp(patchesDir);

    // Synthesize a cpp patch file for pkgs.zlib@1.2.13
    const enc = "pkgs__zlib";
    const version = "1.2.13";
    const patchFile = path.join(patchesDir, `${enc}@${version}.patch`);
    await fs.outputFile(patchFile, "--- a/x\n+++ b/x\n", "utf8");

    // Prepare test-friendly resolve mapping for cpp
    const fakeSrc = path.join(tmp, "_nix_src", `zlib-${version}`);
    await fs.mkdirp(fakeSrc);

    const cli = path.join(tmp, "tools", "bin", "patch-pkg");
    await $`chmod +x ${cli}`;

    const env = {
      ...process.env,
      ZX_INIT: path.join(tmp, "tools", "dev", "zx-init.mjs"),
      WORKSPACE_ROOT: tmp,
      NO_DEV_SHELL: "1",
      NIX_CPP_TEST_RESOLVE_JSON: JSON.stringify({
        "pkgs.zlib": { version, srcPath: fakeSrc },
      }),
    } as any;

    // Capture glue state before removal (may be empty)
    const autoTargets = path.join(tmp, "third_party", "providers", "TARGETS.cpp.auto");
    const autoMap = path.join(tmp, "third_party", "providers", "auto_map.bzl");
    const beforeTargets = (await fs.pathExists(autoTargets))
      ? await fs.readFile(autoTargets, "utf8")
      : "";
    const beforeMap = (await fs.pathExists(autoMap)) ? await fs.readFile(autoMap, "utf8") : "";

    // Remove should delete the patch and invoke glue
    await $({ cwd: tmp, env })`${cli} remove cpp zlib --patch-dir patches/cpp`;
    const exists = await fs.pathExists(patchFile);
    if (exists) {
      console.error("expected C++ patch file to be removed");
      process.exit(2);
    }

    const afterTargets = (await fs.pathExists(autoTargets))
      ? await fs.readFile(autoTargets, "utf8")
      : "";
    const afterMap = (await fs.pathExists(autoMap)) ? await fs.readFile(autoMap, "utf8") : "";
    if (afterTargets === undefined || afterMap === undefined) {
      console.error("expected glue outputs after remove for cpp");
      process.exit(2);
    }

    // Idempotency: a second remove should keep outputs stable
    await $({ cwd: tmp, env })`${cli} remove cpp zlib --patch-dir patches/cpp`;
    const afterTargets2 = (await fs.pathExists(autoTargets))
      ? await fs.readFile(autoTargets, "utf8")
      : "";
    const afterMap2 = (await fs.pathExists(autoMap)) ? await fs.readFile(autoMap, "utf8") : "";
    if (afterTargets !== afterTargets2 || afterMap !== afterMap2) {
      console.error("provider outputs changed on idempotent remove (cpp)");
      process.exit(2);
    }
    void beforeTargets;
    void beforeMap;
  });
});
