#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { ensureOriginAndWorkspace } from "../../../tools/patch/cpp/extract";

test("cpp extract: ensureOriginAndWorkspace uses unique origin/workspace dirs per call", async () => {
  await runInTemp("cpp-extract-unique-ws", async (tmp) => {
    const storeSrc = path.join(tmp, "nix-store", "zlib-src");
    await fsp.mkdir(storeSrc, { recursive: true });
    await fsp.writeFile(path.join(storeSrc, "README"), "zlib\n", "utf8");

    const pre = { pname: "zlib", version: "1.2.13", srcPath: storeSrc };
    const a = await ensureOriginAndWorkspace("pkgs.zlib", pre);
    const b = await ensureOriginAndWorkspace("pkgs.zlib", pre);

    if (a.originPath === b.originPath) {
      console.error("expected originPath to differ across calls", { originPath: a.originPath });
      process.exit(2);
    }
    if (a.workspacePath === b.workspacePath) {
      console.error("expected workspacePath to differ across calls", {
        workspacePath: a.workspacePath,
      });
      process.exit(2);
    }
  });
});
