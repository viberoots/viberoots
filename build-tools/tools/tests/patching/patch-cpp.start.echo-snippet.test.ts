#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("patch-cpp start --echo-snippet prints an export snippet", async () => {
  await runInTemp("patch-cpp-start-echo-snippet", async (tmp, $) => {
    const storeSrc = path.join(tmp, "nix-store", "zlib-src");
    await fsp.mkdir(storeSrc, { recursive: true });
    await fsp.writeFile(path.join(storeSrc, "file.txt"), "A\n", "utf8");
    const map = { "pkgs.zlib": { version: "1.2.13", srcPath: storeSrc, pname: "zlib" } };
    await $`chmod +x build-tools/tools/bin/patch-pkg`;
    const out = await $({
      cwd: tmp,
      stdio: "pipe",
    })`NIX_CPP_TEST_RESOLVE_JSON=${JSON.stringify(
      map,
    )} build-tools/tools/bin/patch-pkg start cpp pkgs.zlib --echo-snippet`;
    const full = [String(out.stdout || ""), String(out.stderr || "")].join("\n");
    if (!full.includes("export NIX_CPP_DEV_OVERRIDE_JSON=")) {
      console.error("expected export snippet in output");
      console.error("--- output start ---\n" + full + "\n--- output end ---");
      process.exit(2);
    }
  });
});
