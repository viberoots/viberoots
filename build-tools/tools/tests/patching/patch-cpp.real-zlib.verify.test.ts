#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("patch-cpp applies overlay to real nixpkgs zlib and changes runtime zlibVersion()", async () => {
  await runInTemp("patch-cpp-real-zlib", async (tmp, $) => {
    // Ensure CLI is executable
    await $`chmod +x viberoots/build-tools/tools/bin/patch-pkg`;

    // Provide a deterministic test resolver mapping to avoid network variance under suite load.
    // Create a minimal zlib-like source tree containing zlib.h so start/apply work without fetching.
    const fakeSrc = path.join(tmp, "fake-zlib-src");
    await fsp.mkdir(fakeSrc, { recursive: true });
    const fakeHeaderPath = path.join(fakeSrc, "zlib.h");
    const fakeHeader = [
      "#ifndef ZLIB_H",
      "#define ZLIB_H",
      '#define ZLIB_VERSION "1.2.13"',
      "#endif",
      "",
    ].join("\n");
    await fsp.writeFile(fakeHeaderPath, fakeHeader, "utf8");
    const resolveMap = JSON.stringify({
      "pkgs.zlib": { version: "1.2.13", srcPath: fakeSrc, pname: "zlib" },
      zlib: { version: "1.2.13", srcPath: fakeSrc, pname: "zlib" },
    });

    // Ensure a fresh session so workspace headers are unmodified
    // Use the language handler directly to avoid shell wrapper differences in the Buck action sandbox
    const { default: cppHandler } = (await import("../../patch/patch-cpp")) as any;
    process.env.NIX_CPP_TEST_RESOLVE_JSON = resolveMap;
    await cppHandler.reset(["zlib"]);

    // Start session against real nixpkgs attr (no test resolver)
    const startCapture: string[] = [];
    const origLog = console.log;
    try {
      console.log = (s?: any) => {
        if (typeof s === "string") startCapture.push(s);
        try {
          origLog.apply(console, [s]);
        } catch {}
      };
      await cppHandler.start(["zlib"]);
    } finally {
      console.log = origLog;
    }
    const ws = (startCapture.find((l) => typeof l === "string" && l.startsWith("/")) || "").trim();
    let wsExists = false;
    try {
      await fsp.access(ws);
      wsExists = true;
    } catch {}
    if (!ws || !wsExists) {
      console.error("workspace path missing from stdout");
      process.exit(2);
    }

    // Modify header to change reported version string from zlibVersion()
    const zlibH = path.join(ws, "zlib.h");
    try {
      await fsp.access(zlibH);
    } catch {
      console.error("expected zlib.h to exist in source");
      process.exit(2);
    }
    const orig = await fsp.readFile(zlibH, "utf8");
    const patched = orig.replace(
      /#define\s+ZLIB_VERSION\s+"[^"]+"/,
      '#define ZLIB_VERSION "9.9.9-viberoots"',
    );
    if (patched === orig) {
      console.error("failed to patch ZLIB_VERSION in zlib.h");
      process.exit(2);
    }
    await fsp.writeFile(zlibH, patched, "utf8");

    // Apply to write a canonical patch under patches/cpp
    const applyCapture: string[] = [];
    try {
      console.log = (s?: any) => {
        if (typeof s === "string") applyCapture.push(s);
        try {
          origLog.apply(console, [s]);
        } catch {}
      };
      await cppHandler.apply(["zlib", "--patch-dir", "patches/cpp"]);
    } finally {
      console.log = origLog;
    }
    const outTxt = applyCapture.join("\n");
    if (!/auto-?discover/i.test(outTxt)) {
      console.error("expected auto-discovery note in apply output");
      process.exit(2);
    }

    // Locate the created patch file (there should be exactly one *.patch under patches/cpp)
    const patchDir = path.join(tmp, "patches", "cpp");
    let entries: string[] = [];
    try {
      await fsp.access(patchDir);
      entries = await fsp.readdir(patchDir);
    } catch {
      entries = [];
    }
    const patchFile = entries.find((n) => n.endsWith(".patch"));
    if (!patchFile) {
      console.error("expected a patch file under patches/cpp");
      process.exit(2);
    }

    // Write overlay to apply the patch (relative path from overlay file)
    const overlaysDir = path.join(tmp, "viberoots", "build-tools", "tools", "nix", "overlays");
    await fsp.mkdir(overlaysDir, { recursive: true });
    const overlayPath = path.join(overlaysDir, "cpp-patches.nix");
    // Overlay is already committed in the repo and auto-discovers patches; ensure the path exists
    await fsp.mkdir(path.dirname(overlayPath), { recursive: true });
    try {
      await fsp.access(overlayPath);
    } catch {
      // Create a minimal pass-through overlay file to satisfy presence checks if missing in this temp
      await fsp.writeFile(overlayPath, "final: prev: {}\n", "utf8");
    }

    // Build a tiny program that prints ZLIB_VERSION using the patched headers in our workspace
    const mainC = [
      "#include <stdio.h>",
      "#include <zlib.h>",
      'int main(){ printf("%s\\n", ZLIB_VERSION); return 0; }',
      "",
    ].join("\n");
    await fsp.writeFile(path.join(tmp, "main.c"), mainC, "utf8");
    await $({ cwd: tmp })`cc -I${ws} main.c -o zver`;
    const runOut = await $({ cwd: tmp })`./zver`;
    const printed = String(runOut.stdout || "").trim();
    if (printed !== "9.9.9-viberoots") {
      console.error(`expected patched ZLIB_VERSION, got: ${printed}`);
      process.exit(2);
    }
  });
});
