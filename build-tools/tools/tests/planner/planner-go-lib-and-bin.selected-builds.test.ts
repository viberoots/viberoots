#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { DEFAULT_GRAPH_PATH } from "../../lib/workspace-state-paths";
import { runInTemp, workspaceFlakeRef } from "../lib/test-helpers";

test("planner builds selected go lib and bin", async () => {
  await runInTemp("planner-go-lib-bin", async (tmp, $) => {
    const graphPath = path.join(tmp, DEFAULT_GRAPH_PATH);
    const graphDir = path.dirname(graphPath);
    await fs.mkdirp(graphDir);

    const appDir = path.join(tmp, "projects/apps/demo-cli");
    const appCmdDir = path.join(appDir, "cmd", "demo-cli");
    await fs.mkdirp(appCmdDir);
    await fs.writeFile(path.join(appCmdDir, "main.go"), "package main\n\nfunc main() {}\n", "utf8");
    await fs.writeFile(
      path.join(appDir, "go.mod"),
      "module example.com/demo-cli\n\ngo 1.22\n",
      "utf8",
    );
    await fs.writeFile(path.join(appDir, "gomod2nix.toml"), "schema = 3\n\n[mod]\n", "utf8");

    const libDir = path.join(tmp, "projects/libs/demo-lib");
    await fs.mkdirp(libDir);
    await fs.writeFile(
      path.join(libDir, "lib.go"),
      "package demolib\n\nfunc Add(a, b int) int { return a + b }\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(libDir, "go.mod"),
      "module example.com/demo-lib\n\ngo 1.22\n",
      "utf8",
    );
    await fs.writeFile(path.join(libDir, "gomod2nix.toml"), "schema = 3\n\n[mod]\n", "utf8");

    const nodes = [
      {
        name: "//projects/apps/demo-cli:demo-cli",
        rule_type: "go_binary",
        labels: ["lang:go", "kind:bin"],
        srcs: ["projects/apps/demo-cli/cmd/demo-cli/main.go"],
      },
      {
        name: "//projects/libs/demo-lib:lib",
        rule_type: "go_library",
        labels: ["lang:go", "kind:lib"],
        srcs: ["projects/libs/demo-lib/lib.go"],
      },
    ];
    await fs.writeFile(graphPath, JSON.stringify(nodes), "utf8");

    const targets = ["//projects/apps/demo-cli:demo-cli", "//projects/libs/demo-lib:lib"];
    for (const BUCK_TARGET of targets) {
      const { stdout } = await $({
        cwd: tmp,
        env: { ...process.env, BUCK_TARGET, BUCK_TEST_SRC: tmp, BUCK_GRAPH_JSON: graphPath },
      })`nix build --impure -L ${`path:${await workspaceFlakeRef(tmp)}#graph-generator-selected`} --accept-flake-config --no-link --print-out-paths`;
      const outPath =
        String(stdout || "")
          .trim()
          .split("\n")
          .filter(Boolean)
          .pop() || "";
      assert.ok(outPath.length > 0, `expected out path for ${BUCK_TARGET}`);
    }
  });
});
