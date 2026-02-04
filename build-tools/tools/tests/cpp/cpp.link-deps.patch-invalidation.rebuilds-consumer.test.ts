#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { sanitizeName } from "../../lib/sanitize";
import { runInTemp } from "../lib/test-helpers";

function systemForHost(): string {
  return process.platform === "darwin" ? "aarch64-darwin" : "x86_64-linux";
}

async function nixBuildSelected(args: {
  tmp: string;
  $: any;
  graphJsonPath: string;
  target: string;
}): Promise<string> {
  const { tmp, $, graphJsonPath, target } = args;
  const system = systemForHost();
  const res = await $({
    cwd: tmp,
    stdio: "pipe",
    nothrow: true,
    reject: false,
    env: { ...process.env, BUCK_TARGET: target },
  })`nix build --impure --accept-flake-config --file build-tools/tools/nix/graph-generator.nix selected --arg pkgs 'import <nixpkgs> {}' --arg src ./. --argstr system ${system} --arg graphJsonPath ${graphJsonPath} --no-link --print-out-paths`;
  if (res.exitCode !== 0) return "";
  const outPath =
    String(res.stdout || "")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .pop() || "";
  return outPath;
}

test("cpp: patch change in repo lib via link_deps rebuilds consumer", async () => {
  await runInTemp("cpp-link-deps-patch-invalidation", async (tmp, $) => {
    const libDir = path.join(tmp, "libs", "greeter");
    const patchFile = path.join(libDir, "patches", "cpp", "greeter@0.0.0.patch");

    await fsp.mkdir(path.join(libDir, "include"), { recursive: true });
    await fsp.mkdir(path.join(libDir, "src"), { recursive: true });
    await fsp.mkdir(path.dirname(patchFile), { recursive: true });

    await fsp.writeFile(
      path.join(libDir, "src", "greeter.cpp"),
      ["int greet() {", "  return 0;", "}", ""].join("\n"),
      "utf8",
    );

    const patchV1 = [
      "diff --git a/src/greeter.cpp b/src/greeter.cpp",
      "--- a/src/greeter.cpp",
      "+++ b/src/greeter.cpp",
      "@@ -1,3 +1,3 @@",
      " int greet() {",
      "-  return 0;",
      "+  return 1;",
      " }",
      "",
    ].join("\n");
    await fsp.writeFile(patchFile, patchV1, "utf8");

    await fsp.writeFile(
      path.join(libDir, "TARGETS"),
      [
        'load("//build-tools/cpp:defs.bzl", "nix_cpp_library")',
        "",
        "nix_cpp_library(",
        '  name = "greeter",',
        '  srcs = ["src/greeter.cpp", "patches/cpp/greeter@0.0.0.patch"],',
        '  labels = ["lang:cpp", "kind:lib"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const appDir = path.join(tmp, "apps", "demo");
    await fsp.mkdir(path.join(appDir, "src"), { recursive: true });
    await fsp.writeFile(
      path.join(appDir, "src", "main.cpp"),
      [
        "#include <iostream>",
        "int greet();",
        "int main() {",
        '  std::cout << greet() << "\\n";',
        "  return 0;",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    await fsp.writeFile(
      path.join(appDir, "TARGETS"),
      [
        'load("//build-tools/cpp:defs.bzl", "nix_cpp_binary")',
        "",
        "nix_cpp_binary(",
        '  name = "demo",',
        '  srcs = ["src/main.cpp"],',
        '  labels = ["lang:cpp", "kind:bin"],',
        '  link_deps = ["//libs/greeter:greeter"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const graph = [
      {
        name: "//libs/greeter:greeter",
        rule_type: "cxx_library",
        labels: ["lang:cpp", "kind:lib"],
        srcs: ["libs/greeter/src/greeter.cpp", "libs/greeter/patches/cpp/greeter@0.0.0.patch"],
      },
      {
        name: "//apps/demo:demo",
        rule_type: "cxx_binary",
        labels: ["lang:cpp", "kind:bin"],
        srcs: ["apps/demo/src/main.cpp"],
        link_deps: ["//libs/greeter:greeter"],
      },
    ];
    const graphJsonPath = path.join(tmp, "build-tools", "tools", "buck", "graph.json");
    await fsp.mkdir(path.dirname(graphJsonPath), { recursive: true });
    await fsp.writeFile(graphJsonPath, JSON.stringify(graph, null, 2) + "\n", "utf8");

    const out1 = await nixBuildSelected({ tmp, $, graphJsonPath, target: "//apps/demo:demo" });
    if (!out1) throw new Error("nix build did not produce an out path for selected target");
    const bin1 = path.join(out1, "bin", sanitizeName("//apps/demo:demo"));
    const run1 = await $({ cwd: tmp, stdio: "pipe" })`${bin1}`;
    const v1 = String(run1.stdout || "").trim();
    if (v1 !== "1")
      throw new Error(
        `expected demo binary to print 1 after initial patch; got=${JSON.stringify(v1)}`,
      );

    const patchV2 = patchV1.replace("+  return 1;", "+  return 2;");
    await fsp.writeFile(patchFile, patchV2, "utf8");

    const out2 = await nixBuildSelected({ tmp, $, graphJsonPath, target: "//apps/demo:demo" });
    if (!out2)
      throw new Error(
        "nix build did not produce an out path for selected target after patch change",
      );
    if (out1 === out2) {
      throw new Error(
        `expected consumer output store path to change after repo lib patch edit; out=${out1}`,
      );
    }
    const bin2 = path.join(out2, "bin", sanitizeName("//apps/demo:demo"));
    const run2 = await $({ cwd: tmp, stdio: "pipe" })`${bin2}`;
    const v2 = String(run2.stdout || "").trim();
    if (v2 !== "2")
      throw new Error(
        `expected demo binary to print 2 after patch change; got=${JSON.stringify(v2)}`,
      );
  });
});
