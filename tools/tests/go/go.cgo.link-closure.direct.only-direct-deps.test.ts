#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("go cgo link_closure=direct does not follow transitive C++ link_deps", async () => {
  await runInTemp("go-cgo-link-closure-direct", async (tmp, $) => {
    const supportDir = path.join(tmp, "libs", "support");
    const coreDir = path.join(tmp, "libs", "core");
    const appDir = path.join(tmp, "apps", "demo");
    await fs.mkdirp(path.join(supportDir, "src"));
    await fs.mkdirp(path.join(coreDir, "src"));
    await fs.mkdirp(path.join(appDir, "cmd", "demo"));

    await fs.writeFile(
      path.join(supportDir, "src", "support.cpp"),
      ['extern "C" int support_add(int a, int b) { return a + b; }', ""].join("\n"),
      "utf8",
    );

    await fs.writeFile(
      path.join(coreDir, "src", "core.cpp"),
      [
        'extern "C" int support_add(int a, int b);',
        'extern "C" int core_add(int a, int b) { return support_add(a, b) + 1; }',
        "",
      ].join("\n"),
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
        'import "fmt"',
        "func main() {",
        "  fmt.Println(C.core_add(10, 2))",
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
        name: "//libs/support:support",
        rule_type: "cxx_library",
        labels: ["lang:cpp", "kind:lib"],
        srcs: ["libs/support/src/support.cpp"],
        link_deps: [],
      },
      {
        name: "//libs/core:core",
        rule_type: "cxx_library",
        labels: ["lang:cpp", "kind:lib"],
        srcs: ["libs/core/src/core.cpp"],
        deps: ["//libs/support:support"],
        link_deps: ["//libs/support:support"],
      },
      {
        name: "//apps/demo:demo",
        rule_type: "go_binary",
        labels: ["lang:go", "kind:bin", "cgo:enabled"],
        srcs: ["apps/demo/cmd/demo/main.go"],
        deps: ["//libs/core:core"],
        link_closure: "direct",
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

    assert.notEqual(
      build.exitCode,
      0,
      "expected nix build to fail when transitive link_deps are not included",
    );
    const err = String(build.stderr || build.stdout || "");
    assert.ok(
      err.includes("support_add"),
      `expected link failure mentioning support_add; got:\n${err}`,
    );
  });
});
