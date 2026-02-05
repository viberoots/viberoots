#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

function systemForHost(): string {
  return process.platform === "darwin" ? "aarch64-darwin" : "x86_64-linux";
}

test("cpp: link_deps rejects unsupported target kinds with actionable error", async () => {
  await runInTemp("cpp-link-deps-unsupported", async (tmp, $) => {
    const appDir = path.join(tmp, "apps", "demo");
    await fsp.mkdir(path.join(appDir, "src"), { recursive: true });
    await fsp.writeFile(path.join(appDir, "src", "main.cpp"), "int main(){return 0;}\n", "utf8");
    await fsp.writeFile(
      path.join(appDir, "TARGETS"),
      [
        'load("//build-tools/cpp:defs.bzl", "nix_cpp_binary")',
        "",
        "nix_cpp_binary(",
        '  name = "demo",',
        '  srcs = ["src/main.cpp"],',
        '  labels = ["lang:cpp", "kind:bin"],',
        '  link_deps = ["//projects/libs/notcpp:notcpp"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const graph = [
      {
        name: "//projects/libs/notcpp:notcpp",
        rule_type: "go_library",
        labels: ["lang:go", "kind:lib"],
        srcs: ["libs/notcpp/lib.go"],
      },
      {
        name: "//projects/apps/demo:demo",
        rule_type: "cxx_binary",
        labels: ["lang:cpp", "kind:bin"],
        srcs: ["apps/demo/src/main.cpp"],
        link_deps: ["//projects/libs/notcpp:notcpp"],
      },
    ];
    const graphJsonPath = path.join(tmp, "build-tools", "tools", "buck", "graph.json");
    await fsp.mkdir(path.dirname(graphJsonPath), { recursive: true });
    await fsp.writeFile(graphJsonPath, JSON.stringify(graph, null, 2) + "\n", "utf8");

    const system = systemForHost();
    const res = await $({
      cwd: tmp,
      stdio: "pipe",
      nothrow: true,
      reject: false,
      env: { ...process.env, BUCK_TARGET: "//projects/apps/demo:demo" },
    })`nix build --impure --accept-flake-config --file build-tools/tools/nix/graph-generator.nix selected --arg pkgs 'import <nixpkgs> {}' --arg src ./. --argstr system ${system} --arg graphJsonPath ${graphJsonPath} --no-link --print-out-paths`;

    if (res.exitCode === 0) {
      throw new Error("expected nix build to fail for unsupported link_deps target");
    }
    const stderr = String(res.stderr || "");
    const wantParts = [
      "cpp planner: link_deps for //projects/apps/demo:demo contains //projects/libs/notcpp:notcpp",
      "expected lang:cpp",
    ];
    for (const p of wantParts) {
      if (!stderr.includes(p)) {
        throw new Error(`expected stderr to include:\n${p}\n\ngot:\n${stderr}`);
      }
    }
  });
});
