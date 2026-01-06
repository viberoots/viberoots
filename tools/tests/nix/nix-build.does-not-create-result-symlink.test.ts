#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("nix build --no-link does not create ./result symlink in temp repos", async () => {
  await runInTemp("nix-build-no-result-symlink", async (tmp, $) => {
    await fsp.mkdir(path.join(tmp, "tools", "buck"), { recursive: true });
    await fsp.writeFile(path.join(tmp, "tools", "buck", "graph.json"), "[]\n", "utf8");

    await $({
      cwd: tmp,
      stdio: "pipe",
    })`nix build ${`path:${tmp}#graph-generator`} --accept-flake-config --no-link --print-out-paths`;

    try {
      await fsp.lstat(path.join(tmp, "result"));
      throw new Error(
        "unexpected ./result symlink created (expected --no-link to avoid out-links)",
      );
    } catch (e: any) {
      if (e && typeof e === "object" && "code" in e && e.code === "ENOENT") {
        return;
      }
      throw e;
    }
  });
});
