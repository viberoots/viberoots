#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("planner builds python binary via selected target when uv.lock present", async () => {
  await runInTemp("planner-python-selected", async (tmp, $) => {
    // Minimal importer with uv.lock
    const appDir = path.join(tmp, "apps", "pytool");
    await fs.mkdirp(appDir);
    await fs.writeFile(path.join(appDir, "uv.lock"), "{}", "utf8");
    await fs.mkdirp(path.join(appDir, "src"));
    await fs.writeFile(path.join(appDir, "src", "main.py"), 'print("ok")\n', "utf8");

    // Minimal Buck graph with a python_binary node
    const graphDir = path.join(tmp, "tools", "buck");
    await fs.mkdirp(graphDir);
    const node = {
      name: "//apps/pytool:cli",
      rule_type: "python_binary",
      labels: ["lang:python", "kind:bin"],
      srcs: ["apps/pytool/src/main.py"],
    };
    await fs.writeFile(
      path.join(graphDir, "graph.json"),
      JSON.stringify([node], null, 2) + "\n",
      "utf8",
    );

    // Build the selected target via Nix planner
    const { stdout, stderr, exitCode } = await $({
      cwd: tmp,
      reject: false,
      nothrow: true,
      env: {
        ...process.env,
        BUCK_TEST_SRC: tmp,
        BUCK_TARGET: "//apps/pytool:cli",
      },
    })`nix build --impure -L ${`path:${tmp}#graph-generator-selected`} --accept-flake-config --print-out-paths`;

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
