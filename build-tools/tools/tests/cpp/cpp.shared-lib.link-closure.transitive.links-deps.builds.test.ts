#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
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
  })`nix build --impure --accept-flake-config --file build-tools/tools/nix/graph-generator.nix selected --arg pkgs 'import <nixpkgs> {}' --arg src ./. --argstr system ${system} --arg graphJsonPath ${graphJsonPath} --no-link --print-out-paths`;
  assert.equal(res.exitCode, 0, String(res.stderr || res.stdout));
  const outPath =
    String(res.stdout || "")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .pop() || "";
  assert.ok(outPath, "nix build did not produce an out path for selected target");
  return outPath;
}

function extractBuildLogLine(buildLog: string, key: string): string {
  const prefix = `${key}=`;
  for (const line of buildLog.split(/\r?\n/)) {
    if (line.startsWith(prefix)) return line.slice(prefix.length);
  }
  return "";
}

test("cpp: shared lib link_closure=transitive follows link_deps", async () => {
  await runInTemp("cpp-shared-lib-transitive-link-closure", async (tmp, $) => {
    await fs.outputFile(
      path.join(tmp, "projects", "libs", "support", "src", "support.cpp"),
      ["int support_answer() { return 4; }", ""].join("\n"),
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
      path.join(tmp, "projects", "libs", "runtime", "src", "runtime.cpp"),
      [
        "extern int core_answer();",
        "int runtime_answer() {",
        "  return core_answer() + 1;",
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
        link_mode: "shared",
      },
      {
        name: "//projects/libs/core:core",
        rule_type: "cxx_library",
        labels: ["lang:cpp", "kind:lib"],
        srcs: ["projects/libs/core/src/core.cpp"],
        link_mode: "shared",
        link_deps: ["//projects/libs/support:support"],
      },
      {
        name: "//projects/libs/runtime:runtime",
        rule_type: "cxx_library",
        labels: ["lang:cpp", "kind:lib"],
        srcs: ["projects/libs/runtime/src/runtime.cpp"],
        link_mode: "shared",
        link_deps: ["//projects/libs/core:core"],
        link_closure: "transitive",
      },
    ];
    const graphJsonPath = path.join(tmp, "build-tools", "tools", "buck", "graph.json");
    await fs.outputFile(graphJsonPath, JSON.stringify(graph, null, 2) + "\n", "utf8");

    const outPath = await nixBuildSelected({
      tmp,
      $,
      graphJsonPath,
      target: "//projects/libs/runtime:runtime",
    });
    const log = await fs.readFile(path.join(outPath, "build.log"), "utf8");
    const linkLibs = extractBuildLogLine(log, "link_libs");
    assert.ok(linkLibs, `expected build.log to include link_libs=...; got:\n${log}`);
    const expect = `-l${sanitizeName("//projects/libs/core:core")} -l${sanitizeName(
      "//projects/libs/support:support",
    )}`;
    assert.equal(linkLibs.trim(), expect);
  });
});
