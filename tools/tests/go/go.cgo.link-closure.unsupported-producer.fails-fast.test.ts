#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("go cgo link_closure fails fast on unsupported producer", async () => {
  await runInTemp("go-cgo-link-closure-unsupported", async (tmp, $) => {
    const coreDir = path.join(tmp, "libs", "core");
    const appDir = path.join(tmp, "apps", "demo");
    await fs.mkdirp(path.join(coreDir, "src"));
    await fs.mkdirp(path.join(appDir, "cmd", "demo"));

    await fs.writeFile(
      path.join(coreDir, "src", "core.cpp"),
      ['extern "C" int core_add(int a, int b) { return a + b; }', ""].join("\n"),
      "utf8",
    );

    await fs.writeFile(
      path.join(appDir, "cmd", "demo", "main.go"),
      [
        "package main",
        "/*",
        "#cgo LDFLAGS: -lstdc++",
        "extern int core_add(int a, int b);",
        "*/",
        'import "C"',
        "func main() {",
        "  _ = C.core_add(1, 2)",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    await fs.writeFile(
      path.join(appDir, "go.mod"),
      ["module example.com/demo", "", "go 1.22", ""].join("\n"),
      "utf8",
    );
    await fs.writeFile(path.join(appDir, "gomod2nix.toml"), "schema = 3\n\n[mod]\n", "utf8");

    const graph = [
      {
        name: "//libs/bad:bad",
        rule_type: "genrule",
        labels: ["lang:node", "kind:lib"],
        srcs: [],
      },
      {
        name: "//libs/core:core",
        rule_type: "cxx_library",
        labels: ["lang:cpp", "kind:lib"],
        srcs: ["libs/core/src/core.cpp"],
        link_deps: ["//libs/bad:bad"],
      },
      {
        name: "//apps/demo:demo",
        rule_type: "go_binary",
        labels: ["lang:go", "kind:bin", "cgo:enabled"],
        srcs: ["apps/demo/cmd/demo/main.go"],
        deps: ["//libs/core:core"],
        link_closure: "transitive",
        link_closure_overrides: {},
      },
    ];
    const graphJsonPath = path.join(tmp, "tools", "buck", "graph.json");
    await fs.mkdirp(path.dirname(graphJsonPath));
    await fs.writeFile(graphJsonPath, JSON.stringify(graph, null, 2) + "\n", "utf8");

    const build = await $({
      cwd: tmp,
      stdio: "pipe",
      nothrow: true,
      reject: false,
      env: {
        ...process.env,
        BUCK_TEST_SRC: tmp,
        BUCK_TARGET: "//apps/demo:demo",
      },
    })`nix build --impure -L ${`path:${tmp}#graph-generator-selected`} --accept-flake-config --no-link --print-out-paths`;

    assert.notEqual(build.exitCode, 0, "expected nix build to fail");
    const err = String(build.stderr || build.stdout || "");
    assert.ok(
      err.includes("unsupported") && err.includes("lang:cpp"),
      `expected unsupported producer error; got:\n${err}`,
    );
  });
});
