#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("planner selected outputs resolve for go/cpp/python targets", async () => {
  await runInTemp("planner-go-targets", async (tmp, $) => {
    const graphDir = path.join(tmp, "tools/buck");
    await fs.mkdirp(graphDir);
    await fs.outputFile(
      path.join(tmp, "apps", "goapp", "cmd", "goapp", "main.go"),
      "package main\n\nfunc main() {}\n",
      "utf8",
    );
    await fs.outputFile(
      path.join(tmp, "apps", "goapp", "gomod2nix.toml"),
      [
        "schema = 3",
        "mod = {}",
        "replace = {}",
        "prune = { go-tests = true, unused-packages = true }",
        "",
      ].join("\n"),
      "utf8",
    );
    await fs.outputFile(
      path.join(tmp, "apps", "cppapp", "main.cc"),
      "int main() { return 0; }\n",
      "utf8",
    );
    await fs.outputFile(path.join(tmp, "apps", "pyapp", "uv.lock"), "{}", "utf8");
    await fs.outputFile(path.join(tmp, "apps", "pyapp", "src", "main.py"), 'print("ok")\n', "utf8");

    const nodes = [
      {
        name: "//apps/goapp:goapp",
        rule_type: "go_binary",
        labels: ["lang:go", "kind:bin"],
        srcs: ["apps/goapp/cmd/goapp/main.go"],
      },
      {
        name: "//apps/cppapp:cppapp",
        rule_type: "cxx_binary",
        labels: ["lang:cpp", "kind:bin"],
        srcs: ["apps/cppapp/main.cc"],
      },
      {
        name: "//apps/pyapp:pyapp",
        rule_type: "python_binary",
        labels: ["lang:python", "kind:bin"],
        srcs: ["apps/pyapp/src/main.py"],
      },
    ];
    await fs.writeFile(path.join(graphDir, "graph.json"), JSON.stringify(nodes), "utf8");

    const targets = ["//apps/goapp:goapp", "//apps/cppapp:cppapp", "//apps/pyapp:pyapp"];
    for (const BUCK_TARGET of targets) {
      const { stdout } = await $({
        cwd: tmp,
        env: { ...process.env, BUCK_TARGET },
      })`nix eval --impure --accept-flake-config ${`path:${tmp}#graph-generator-selected.drvPath`} --raw`;
      const out = String(stdout || "").trim();
      assert.ok(out.endsWith(".drv"), `expected drvPath for ${BUCK_TARGET}`);
    }
  });
});
