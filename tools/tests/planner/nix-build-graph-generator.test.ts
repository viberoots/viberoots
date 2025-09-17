#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import fs from "fs-extra";
import path from "node:path";
import { runInTemp } from "../lib/test-helpers";

test("nix builds graph-generator", async () => {
  await runInTemp("nix-build-graph-generator", async (tmp, $) => {
    await fs.mkdirp(path.join(tmp, "tools/buck"));
    await fs.writeFile(path.join(tmp, "tools/buck/graph.json"), "[]\n", "utf8");
    const { stdout } = await $({ cwd: tmp })`nix build .#graph-generator --print-out-paths`;
    if (!String(stdout || "").trim()) {
      console.error("graph-generator produced no out path");
      process.exit(2);
    }
  });
});
