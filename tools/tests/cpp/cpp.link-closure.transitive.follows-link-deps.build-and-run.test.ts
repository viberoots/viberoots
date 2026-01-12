#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

function systemForHost(): string {
  return process.platform === "darwin" ? "aarch64-darwin" : "x86_64-linux";
}

function parseOutPath(stdout: unknown): string {
  return String(stdout || "")
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .pop()!;
}

test("cpp: link_closure=transitive follows link_deps closure (build + run)", async () => {
  await runInTemp("cpp-link-closure-transitive", async (tmp, $) => {
    await fs.outputFile(
      path.join(tmp, "libs", "support", "src", "support.cpp"),
      ["int support_answer() { return 10; }", ""].join("\n"),
      "utf8",
    );
    await fs.outputFile(
      path.join(tmp, "libs", "core", "src", "core.cpp"),
      [
        "extern int support_answer();",
        "int core_answer() {",
        "  return support_answer() + 1;",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    await fs.outputFile(
      path.join(tmp, "apps", "demo", "src", "main.cpp"),
      [
        "#include <cstdio>",
        "extern int core_answer();",
        "int main() {",
        '  std::printf("answer=%d\\n", core_answer());',
        "  return 0;",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

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
        link_deps: ["//libs/support:support"],
      },
      {
        name: "//apps/demo:demo",
        rule_type: "cxx_binary",
        labels: ["lang:cpp", "kind:bin"],
        srcs: ["apps/demo/src/main.cpp"],
        link_deps: ["//libs/core:core"],
        link_closure: "transitive",
      },
    ];
    const graphJsonPath = path.join(tmp, "tools", "buck", "graph.json");
    await fs.outputFile(graphJsonPath, JSON.stringify(graph, null, 2) + "\n", "utf8");

    const system = systemForHost();
    const build = await $({
      cwd: tmp,
      stdio: "pipe",
      nothrow: true,
      reject: false,
      env: { ...process.env, BUCK_TARGET: "//apps/demo:demo" },
    })`nix build --impure --accept-flake-config --file tools/nix/graph-generator.nix selected --arg pkgs 'import <nixpkgs> {}' --arg src ./. --argstr system ${system} --arg graphJsonPath ${graphJsonPath} --no-link --print-out-paths`;
    assert.equal(build.exitCode, 0, String(build.stderr || build.stdout));

    const outPath = parseOutPath(build.stdout);
    const binDir = path.join(outPath, "bin");
    const bins = (await fs.readdir(binDir).catch(() => [])) as string[];
    assert.ok(bins.length > 0, `no binaries found under ${binDir}`);

    const res = await $({ cwd: tmp, stdio: "pipe" })`${path.join(binDir, bins[0])}`;
    assert.match(String(res.stdout || ""), /^answer=11\b/m);
  });
});
