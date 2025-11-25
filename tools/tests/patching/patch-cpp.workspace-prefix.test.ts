#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("patch-cpp: workspace parent dir is bucknix-patch-cpp", async () => {
  await runInTemp("patch-cpp-ws-prefix", async (tmp, $) => {
    const storeSrc = path.join(tmp, "nix-store", "zlib-src");
    await fsp.mkdir(storeSrc, { recursive: true });
    await fsp.writeFile(path.join(storeSrc, "README"), "zlib\n", "utf8");
    const map = { "pkgs.zlib": { version: "1.2.13", srcPath: storeSrc, pname: "zlib" } };

    await $`chmod +x tools/bin/patch-pkg`;
    const r = await $({
      cwd: tmp,
    })`NIX_CPP_TEST_RESOLVE_JSON=${JSON.stringify(map)} tools/bin/patch-pkg start cpp pkgs.zlib`;
    const ws = String(r.stdout || "")
      .trim()
      .split(/\s+/)
      .pop() as string;
    if (!ws) {
      console.error("missing workspace path on stdout");
      process.exit(2);
    }
    const parent = path.basename(path.dirname(ws));
    if (parent !== "bucknix-patch-cpp") {
      console.error("unexpected workspace parent dir", { parent, ws });
      process.exit(2);
    }
  });
});
