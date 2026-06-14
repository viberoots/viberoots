#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { DEFAULT_GRAPH_PATH } from "../../lib/workspace-state-paths";
import { runInTemp } from "../lib/test-helpers";

test("planner selected outputs resolve for go/cpp/python targets", async () => {
  await runInTemp("planner-go-targets", async (tmp, $) => {
    const graphDir = path.dirname(path.join(tmp, DEFAULT_GRAPH_PATH));
    await fs.mkdirp(graphDir);
    await fs.outputFile(
      path.join(tmp, "projects", "apps", "goapp", "cmd", "goapp", "main.go"),
      "package main\n\nfunc main() {}\n",
      "utf8",
    );
    await fs.outputFile(
      path.join(tmp, "projects", "apps", "goapp", "gomod2nix.toml"),
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
      path.join(tmp, "projects", "apps", "cppapp", "main.cc"),
      "int main() { return 0; }\n",
      "utf8",
    );
    await fs.outputFile(path.join(tmp, "projects", "apps", "pyapp", "uv.lock"), "{}", "utf8");
    await fs.outputFile(
      path.join(tmp, "projects", "apps", "pyapp", "src", "main.py"),
      'print("ok")\n',
      "utf8",
    );

    const nodes = [
      {
        name: "//projects/apps/goapp:goapp",
        rule_type: "go_binary",
        labels: ["lang:go", "kind:bin"],
        srcs: ["projects/apps/goapp/cmd/goapp/main.go"],
      },
      {
        name: "//projects/apps/cppapp:cppapp",
        rule_type: "cxx_binary",
        labels: ["lang:cpp", "kind:bin"],
        srcs: ["projects/apps/cppapp/main.cc"],
      },
      {
        name: "//projects/apps/pyapp:pyapp",
        rule_type: "python_binary",
        labels: ["lang:python", "kind:bin"],
        srcs: ["projects/apps/pyapp/src/main.py"],
      },
    ];
    await fs.writeFile(path.join(tmp, DEFAULT_GRAPH_PATH), JSON.stringify({ nodes }), "utf8");

    const kindExpr = `
      let
        pkgs = import <nixpkgs> {};
        lib = pkgs.lib;
        graph = builtins.fromJSON (builtins.readFile ./.viberoots/workspace/buck/graph.json);
        nodes = if builtins.isList graph then graph else graph.nodes or [];
        get = attrs: k: if builtins.hasAttr k attrs then attrs.\${k} else null;
        ctx = {
          inherit lib get nodes;
          T = {};
          repoRoot = ./.;
          pkgPathOf = name: ".";
          modulesTomlFor = name: "";
          localModuleOverrides = {};
        };
        go = (import ./build-tools/tools/nix/planner/go.nix { inherit lib; }) ctx;
        cpp = (import ./build-tools/tools/nix/planner/cpp.nix { inherit lib; }) ctx;
        py = (import ./build-tools/tools/nix/planner/python-core.nix { inherit lib; ctx = ctx; });
        pick = name: builtins.head (builtins.filter (n: (get n "name") == name) nodes);
        goKind = go.kindOf (pick "//projects/apps/goapp:goapp");
        cppKind = cpp.kindOf (pick "//projects/apps/cppapp:cppapp");
        pyKind = py.kindOf (pick "//projects/apps/pyapp:pyapp");
      in { inherit goKind cppKind pyKind; }
    `;
    const { stdout: kindOut } = await $({ cwd: tmp })`nix eval --impure --expr ${kindExpr} --json`;
    const kindObj = JSON.parse(String(kindOut || "{}"));
    assert.equal(kindObj.goKind, "bin");
    assert.equal(kindObj.cppKind, "bin");
    assert.equal(kindObj.pyKind, "bin");

    const targets = [
      "//projects/apps/goapp:goapp",
      "//projects/apps/cppapp:cppapp",
      "//projects/apps/pyapp:pyapp",
    ];
    for (const BUCK_TARGET of targets) {
      const { stdout } = await $({
        cwd: tmp,
        env: { ...process.env, BUCK_TARGET, BUCK_TEST_SRC: tmp },
      })`nix eval --impure --accept-flake-config ${`path:${tmp}#graph-generator-selected.drvPath`} --raw`;
      const out = String(stdout || "").trim();
      assert.ok(out.endsWith(".drv"), `expected drvPath for ${BUCK_TARGET}`);
    }
  });
});
