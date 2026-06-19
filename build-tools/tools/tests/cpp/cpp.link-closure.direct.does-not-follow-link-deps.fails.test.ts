#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

function systemForHost(): string {
  return process.platform === "darwin" ? "aarch64-darwin" : "x86_64-linux";
}

test("cpp: link_closure=direct does not follow transitive link_deps (fails deterministically)", async () => {
  await runInTemp("cpp-link-closure-direct-fails", async (tmp, $) => {
    await fs.outputFile(
      path.join(tmp, "projects", "libs", "support", "src", "support.cpp"),
      ["int support_answer() { return 10; }", ""].join("\n"),
      "utf8",
    );
    await fs.outputFile(
      path.join(tmp, "projects", "libs", "core", "src", "core.cpp"),
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
      path.join(tmp, "projects", "apps", "demo", "src", "main.cpp"),
      [
        "extern int core_answer();",
        "int main() {",
        "  return core_answer() == 11 ? 0 : 1;",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

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
        link_deps: ["//projects/libs/support:support"],
      },
      {
        name: "//projects/apps/demo:demo",
        rule_type: "cxx_binary",
        labels: ["lang:cpp", "kind:bin"],
        srcs: ["projects/apps/demo/src/main.cpp"],
        link_deps: ["//projects/libs/core:core"],
        link_closure: "direct",
      },
    ];
    const graphJsonPath = path.join(tmp, ".viberoots", "workspace", "buck", "graph.json");
    await fs.outputFile(graphJsonPath, JSON.stringify(graph, null, 2) + "\n", "utf8");

    const system = systemForHost();
    const build = await $({
      cwd: tmp,
      stdio: "pipe",
      nothrow: true,
      reject: false,
      env: { ...process.env, BUCK_TARGET: "//projects/apps/demo:demo" },
    })`nix build --impure --accept-flake-config --file viberoots/build-tools/tools/nix/graph-generator.nix selected --arg pkgs 'import <nixpkgs> {}' --arg src ./. --argstr system ${system} --arg graphJsonPath ${graphJsonPath} --no-link --print-out-paths`;

    if (build.exitCode === 0) {
      throw new Error(
        "expected nix build to fail for link_closure=direct (missing transitive libs)",
      );
    }
    const err = String(build.stderr || build.stdout || "");
    assert.ok(
      err.includes("support_answer"),
      `expected link failure mentioning support_answer; got:\n${err}`,
    );
  });
});
