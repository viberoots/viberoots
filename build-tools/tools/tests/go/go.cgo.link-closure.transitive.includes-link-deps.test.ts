#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

async function nixBuildSelected(tmp: string, $: any, target: string) {
  const res = await $({
    cwd: tmp,
    stdio: "pipe",
    nothrow: true,
    reject: false,
    env: {
      ...process.env,
      BUCK_TEST_SRC: tmp,
      BUCK_TARGET: target,
    },
  })`nix build --impure -L ${`path:${tmp}#graph-generator-selected`} --accept-flake-config --no-link --print-out-paths`;
  if (res.exitCode !== 0) {
    console.error(String(res.stderr || res.stdout || ""));
    throw new Error(`nix build failed (exit=${res.exitCode})`);
  }
  const outPath =
    String(res.stdout || "")
      .trim()
      .split(/\n+/)
      .pop() || "";
  assert.ok(outPath.startsWith("/"), `expected nix out path, got: ${outPath}`);
  return outPath;
}

test("go cgo link_closure=transitive follows C++ link_deps", async () => {
  await runInTemp("go-cgo-link-closure-transitive", async (tmp, $) => {
    const supportDir = path.join(tmp, "projects", "libs", "support");
    const coreDir = path.join(tmp, "projects", "libs", "core");
    const appDir = path.join(tmp, "projects", "apps", "demo");
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
        name: "//projects/libs/support:support",
        rule_type: "cxx_library",
        labels: ["lang:cpp", "kind:lib"],
        srcs: ["projects/libs/support/src/support.cpp"],
        link_deps: [],
      },
      {
        name: "//projects/libs/core:core",
        rule_type: "cxx_library",
        labels: ["lang:cpp", "kind:lib"],
        srcs: ["projects/libs/core/src/core.cpp"],
        deps: ["//projects/libs/support:support"],
        link_deps: ["//projects/libs/support:support"],
      },
      {
        name: "//projects/apps/demo:demo",
        rule_type: "go_binary",
        labels: ["lang:go", "kind:bin", "cgo:enabled"],
        srcs: ["projects/apps/demo/cmd/demo/main.go"],
        deps: ["//projects/libs/core:core"],
        link_closure: "transitive",
        link_closure_overrides: {},
      },
    ];
    const graphJsonPath = path.join(tmp, "build-tools", "tools", "buck", "graph.json");
    await fs.mkdirp(path.dirname(graphJsonPath));
    await fs.writeFile(graphJsonPath, JSON.stringify(graph, null, 2) + "\n", "utf8");

    const outPath = await nixBuildSelected(tmp, $, "//projects/apps/demo:demo");
    const binDir = path.join(outPath, "bin");
    const bins = (await fs.readdir(binDir)).filter(Boolean);
    assert.ok(bins.length >= 1, `expected at least one binary in ${binDir}`);
    const demoBin = path.join(binDir, bins[0]!);
    const run = await $({ cwd: tmp, stdio: "pipe", nothrow: true, reject: false })`${demoBin}`;
    assert.equal(run.exitCode, 0, String(run.stderr || ""));
    assert.equal(String(run.stdout || "").trim(), "13");
  });
});
