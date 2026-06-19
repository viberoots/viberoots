#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("patch-cpp apply writes encoded patch filename and auto-discovery note", async () => {
  await runInTemp("patch-cpp-apply-create", async (tmp, $) => {
    const storeSrc = path.join(tmp, "nix-store", "zlib-src");
    await fsp.mkdir(storeSrc, { recursive: true });
    await fsp.writeFile(path.join(storeSrc, "file.txt"), "A\n", "utf8");
    const map = { "pkgs.zlib": { version: "1.2.13", srcPath: storeSrc, pname: "zlib" } };

    await $`chmod +x viberoots/build-tools/tools/bin/patch-pkg`;
    const wsOut = await $({
      cwd: tmp,
    })`PATCH_CPP_DEBUG=1 NIX_CPP_TEST_RESOLVE_JSON=${JSON.stringify(
      map,
    )} viberoots/build-tools/tools/bin/patch-pkg start cpp pkgs.zlib`;
    const ws = String(wsOut.stdout).trim().split(/\s+/).pop() as string;
    await fsp.writeFile(path.join(ws, "file.txt"), "B\n", "utf8");

    const out = await $({ cwd: tmp })`PATCH_CPP_DEBUG=1 NIX_CPP_TEST_RESOLVE_JSON=${JSON.stringify(
      map,
    )} viberoots/build-tools/tools/bin/patch-pkg apply cpp --target //projects/libs/core:lib zlib`;
    const outTxtAll = String(out.stdout || out.stderr || "");
    const printed = outTxtAll
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.endsWith(".patch") && l.startsWith("/"));
    const patch = printed || path.join(tmp, "libs/core/patches/cpp", "pkgs__zlib@1.2.13.patch");
    try {
      await fsp.access(patch);
    } catch {
      console.error("expected cpp patch file missing");
      console.error(
        "--- captured output start ---\n" + outTxtAll + "\n--- captured output end ---",
      );
      try {
        const dir = path.dirname(patch);
        const ls = await $({ cwd: tmp, stdio: "pipe" })`ls -la ${dir}`.nothrow();
        console.error(
          "--- dir listing start ---\n" +
            String(ls.stdout || ls.stderr || "") +
            "\n--- dir listing end ---",
        );
      } catch {}
      process.exit(2);
    }

    const txt = String(out.stdout || "");
    if (!txt.toLowerCase().includes("auto-discovers patches")) {
      console.error("expected auto-discovery note in stdout");
      console.error(
        "--- captured output start ---\n" + outTxtAll + "\n--- captured output end ---",
      );
      process.exit(2);
    }
  });
});
