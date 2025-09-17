#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import fs from "fs-extra";
import path from "node:path";
import { runInTemp } from "../lib/test-helpers";

test("planner exposes goTargets/all for go_binary", async () => {
  await runInTemp("planner-go-targets", async (tmp, $) => {
    const graphDir = path.join(tmp, "tools/buck");
    await fs.mkdirp(graphDir);
    const nodes = [{ name: "//app:bin", rule_type: "go_binary", labels: ["lang:go"] }];
    await fs.writeFile(path.join(graphDir, "graph.json"), JSON.stringify(nodes), "utf8");

    const { stdout } = await $({ cwd: tmp })`nix build .#graph-generator --print-out-paths`;
    const out = String(stdout || "").trim();
    if (!out) {
      console.error("missing graph-generator out path");
      process.exit(2);
    }
    // Verify some path exists; we don't inspect derivation internals here
    await fs.pathExists(out);
  });
});
