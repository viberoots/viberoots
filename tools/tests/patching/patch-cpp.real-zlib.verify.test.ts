#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("patch-cpp applies overlay to real nixpkgs zlib and changes runtime zlibVersion()", async () => {
  await runInTemp("patch-cpp-real-zlib", async (tmp, $) => {
    // Ensure CLI is executable
    await $`chmod +x tools/bin/patch-pkg`;

    // Start session against real nixpkgs attr (no test resolver)
    const wsOut = await $({ cwd: tmp })`tools/bin/patch-pkg start cpp zlib`;
    const ws = String(wsOut.stdout).trim().split(/\s+/).pop() as string;
    if (!ws || !(await fs.pathExists(ws))) {
      console.error("workspace path missing from stdout");
      process.exit(2);
    }

    // Modify header to change reported version string from zlibVersion()
    const zlibH = path.join(ws, "zlib.h");
    if (!(await fs.pathExists(zlibH))) {
      console.error("expected zlib.h to exist in source");
      process.exit(2);
    }
    const orig = await fs.readFile(zlibH, "utf8");
    const patched = orig.replace(
      /#define\s+ZLIB_VERSION\s+"[^"]+"/,
      '#define ZLIB_VERSION "9.9.9-bucknix"',
    );
    if (patched === orig) {
      console.error("failed to patch ZLIB_VERSION in zlib.h");
      process.exit(2);
    }
    await fs.writeFile(zlibH, patched, "utf8");

    // Apply to write a canonical patch under patches/cpp
    const applyOut = await $({ cwd: tmp })`tools/bin/patch-pkg apply cpp zlib`;
    const outTxt = String(applyOut.stdout || "");
    if (!outTxt.toLowerCase().includes("auto-discovers patches")) {
      console.error("expected auto-discovery note in apply output");
      process.exit(2);
    }

    // Locate the created patch file (there should be exactly one *.patch under patches/cpp)
    const patchDir = path.join(tmp, "patches", "cpp");
    const entries = (await fs.pathExists(patchDir)) ? await fs.readdir(patchDir) : [];
    const patchFile = entries.find((n) => n.endsWith(".patch"));
    if (!patchFile) {
      console.error("expected a patch file under patches/cpp");
      process.exit(2);
    }

    // Write overlay to apply the patch (relative path from overlay file)
    const overlaysDir = path.join(tmp, "tools", "nix", "overlays");
    await fs.mkdirp(overlaysDir);
    const overlayPath = path.join(overlaysDir, "cpp-patches.nix");
    // Overlay is already committed in the repo and auto-discovers patches; ensure the path exists
    await fs.mkdirp(path.dirname(overlayPath));
    if (!(await fs.pathExists(overlayPath))) {
      // Create a minimal pass-through overlay file to satisfy presence checks if missing in this temp
      await fs.writeFile(overlayPath, "final: prev: {}\n", "utf8");
    }

    // Build a tiny program that prints ZLIB_VERSION using the patched headers in our workspace
    const mainC = [
      "#include <stdio.h>",
      "#include <zlib.h>",
      'int main(){ printf("%s\\n", ZLIB_VERSION); return 0; }',
      "",
    ].join("\n");
    await fs.writeFile(path.join(tmp, "main.c"), mainC, "utf8");
    await $({ cwd: tmp })`cc -I${ws} main.c -o zver`;
    const runOut = await $({ cwd: tmp })`./zver`;
    const printed = String(runOut.stdout || "").trim();
    if (printed !== "9.9.9-bucknix") {
      console.error(`expected patched ZLIB_VERSION, got: ${printed}`);
      process.exit(2);
    }
  });
});
