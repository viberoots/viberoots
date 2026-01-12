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

test("cpp: link_closure_overrides apply deterministically (ordering locked by build.log)", async () => {
  await runInTemp("cpp-link-closure-overrides", async (tmp, $) => {
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
      path.join(tmp, "libs", "alpha", "src", "alpha.cpp"),
      ["int alpha_answer() { return 1; }", ""].join("\n"),
      "utf8",
    );
    await fs.outputFile(
      path.join(tmp, "apps", "demo", "src", "main.cpp"),
      [
        "extern int core_answer();",
        "extern int alpha_answer();",
        "int main() {",
        "  return (core_answer() + alpha_answer()) == 12 ? 0 : 1;",
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
        name: "//libs/alpha:alpha",
        rule_type: "cxx_library",
        labels: ["lang:cpp", "kind:lib"],
        srcs: ["libs/alpha/src/alpha.cpp"],
        link_deps: [],
      },
      {
        name: "//apps/demo:demo",
        rule_type: "cxx_binary",
        labels: ["lang:cpp", "kind:bin"],
        srcs: ["apps/demo/src/main.cpp"],
        link_deps: ["//libs/core:core", "//libs/alpha:alpha"],
        link_closure: "direct",
        link_closure_overrides: {
          "//libs/core:core": "transitive",
        },
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

    const expected = [
      `-l${sanitizeName("//libs/core:core")}`,
      `-l${sanitizeName("//libs/support:support")}`,
      `-l${sanitizeName("//libs/alpha:alpha")}`,
    ].join(" ");
    if (linkLibs1.trim() !== expected) {
      throw new Error(
        `expected deterministic link_libs order:\nwant=${expected}\ngot=${linkLibs1}`,
      );
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
