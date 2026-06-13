#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { DEFAULT_GRAPH_PATH } from "../../lib/workspace-state-paths";
import { runInTemp } from "../lib/test-helpers";

test("planner builds python library via selected target when uv.lock present", async () => {
  await runInTemp("planner-python-lib-selected", async (tmp, $) => {
    const appDir = path.join(tmp, "projects", "apps", "pylib");
    await fs.mkdirp(path.join(appDir, "src", "pylib"));
    await fs.writeFile(path.join(appDir, "uv.lock"), "{}", "utf8");
    await fs.writeFile(path.join(appDir, "src", "pylib", "__init__.py"), "value = 1\n", "utf8");

    const graphPath = path.join(tmp, DEFAULT_GRAPH_PATH);
    const graphDir = path.dirname(graphPath);
    await fs.mkdirp(graphDir);
    const node = {
      name: "//projects/apps/pylib:pylib",
      rule_type: "python_library",
      labels: ["lang:python", "kind:lib"],
      srcs: ["projects/apps/pylib/src/pylib/__init__.py"],
    };
    await fs.writeFile(graphPath, JSON.stringify([node], null, 2) + "\n", "utf8");

    const { stdout, stderr, exitCode } = await $({
      cwd: tmp,
      reject: false,
      nothrow: true,
      env: {
        ...process.env,
        BUCK_TEST_SRC: tmp,
        BUCK_GRAPH_JSON: graphPath,
        BUCK_TARGET: "//projects/apps/pylib:pylib",
      },
    })`nix build --impure -L ${`path:${tmp}#graph-generator-selected`} --accept-flake-config --no-link --print-out-paths`;

    if (exitCode !== 0) {
      console.error(stderr);
      process.exit(2);
    }
    const outPath =
      String(stdout || "")
        .trim()
        .split(/\n+/)
        .pop() || "";
    if (!outPath) {
      console.error("expected an out path from graph-generator-selected");
      process.exit(2);
    }
  });
});
