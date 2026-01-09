#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
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
  })`nix build --impure --accept-flake-config --file tools/nix/graph-generator.nix selected --arg pkgs 'import <nixpkgs> {}' --arg src ./. --argstr system ${system} --arg graphJsonPath ${graphJsonPath} --no-link --print-out-paths`;
  if (res.exitCode !== 0) return "";
  const outPath =
    String(res.stdout || "")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .pop() || "";
  return outPath;
}

function extractBuildLogLine(buildLog: string, key: string): string {
  const prefix = `${key}=`;
  for (const line of buildLog.split(/\r?\n/)) {
    if (line.startsWith(prefix)) return line.slice(prefix.length);
  }
  return "";
}

test("cpp: link input ordering is deterministic (repo link deps)", async () => {
  await runInTemp("cpp-link-ordering-deterministic", async (tmp, $) => {
    const libsAlpha = path.join(tmp, "libs", "alpha");
    await fs.outputFile(
      path.join(libsAlpha, "src", "alpha.cpp"),
      ["int alpha() { return 1; }", ""].join("\n"),
      "utf8",
    );
    await fs.outputFile(
      path.join(libsAlpha, "TARGETS"),
      [
        'load("//cpp:defs.bzl", "nix_cpp_library")',
        "",
        "nix_cpp_library(",
        '  name = "alpha",',
        '  srcs = ["src/alpha.cpp"],',
        '  labels = ["lang:cpp", "kind:lib"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const libsBravo = path.join(tmp, "libs", "bravo");
    await fs.outputFile(
      path.join(libsBravo, "src", "bravo.cpp"),
      ["int bravo() { return 2; }", ""].join("\n"),
      "utf8",
    );
    await fs.outputFile(
      path.join(libsBravo, "TARGETS"),
      [
        'load("//cpp:defs.bzl", "nix_cpp_library")',
        "",
        "nix_cpp_library(",
        '  name = "bravo",',
        '  srcs = ["src/bravo.cpp"],',
        '  labels = ["lang:cpp", "kind:lib"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const appDir = path.join(tmp, "apps", "demo");
    await fs.outputFile(
      path.join(appDir, "src", "main.cpp"),
      [
        "#include <iostream>",
        "int alpha();",
        "int bravo();",
        "int main() {",
        '  std::cout << (alpha() + bravo()) << "\\n";',
        "  return 0;",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    await fs.outputFile(
      path.join(appDir, "TARGETS"),
      [
        'load("//cpp:defs.bzl", "nix_cpp_binary")',
        "",
        "nix_cpp_binary(",
        '  name = "demo",',
        '  srcs = ["src/main.cpp"],',
        '  labels = ["lang:cpp", "kind:bin"],',
        '  link_deps = ["//libs/bravo:bravo", "//libs/alpha:alpha"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const graph = [
      {
        name: "//libs/alpha:alpha",
        rule_type: "cxx_library",
        labels: ["lang:cpp", "kind:lib"],
        srcs: ["libs/alpha/src/alpha.cpp"],
      },
      {
        name: "//libs/bravo:bravo",
        rule_type: "cxx_library",
        labels: ["lang:cpp", "kind:lib"],
        srcs: ["libs/bravo/src/bravo.cpp"],
      },
      {
        name: "//apps/demo:demo",
        rule_type: "cxx_binary",
        labels: ["lang:cpp", "kind:bin"],
        srcs: ["apps/demo/src/main.cpp"],
        link_deps: ["//libs/bravo:bravo", "//libs/alpha:alpha"],
      },
    ];
    const graphJsonPath = path.join(tmp, "tools", "buck", "graph.json");
    await fs.outputFile(graphJsonPath, JSON.stringify(graph, null, 2) + "\n", "utf8");

    const out1 = await nixBuildSelected({ tmp, $, graphJsonPath, target: "//apps/demo:demo" });
    if (!out1) throw new Error("nix build did not produce an out path for selected target");
    const log1 = await fs.readFile(path.join(out1, "build.log"), "utf8");
    const linkLibs1 = extractBuildLogLine(log1, "link_libs");
    if (!linkLibs1) {
      throw new Error(`expected build.log to include link_libs=...; got:\n${log1}`);
    }

    const expect1 = `-l${sanitizeName("//libs/bravo:bravo")} -l${sanitizeName("//libs/alpha:alpha")}`;
    if (linkLibs1.trim() !== expect1) {
      throw new Error(`expected deterministic link_libs order:\nwant=${expect1}\ngot=${linkLibs1}`);
    }

    const out2 = await nixBuildSelected({ tmp, $, graphJsonPath, target: "//apps/demo:demo" });
    if (!out2)
      throw new Error("nix build did not produce an out path for selected target (second build)");
    const log2 = await fs.readFile(path.join(out2, "build.log"), "utf8");
    if (log1 !== log2) {
      throw new Error(
        `expected build.log to be identical across repeated builds\nbefore:\n${log1}\nafter:\n${log2}`,
      );
    }
  });
});
