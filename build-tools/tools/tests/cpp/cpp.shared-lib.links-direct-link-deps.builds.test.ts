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
  })`nix build --impure --accept-flake-config --file viberoots/build-tools/tools/nix/graph-generator.nix selected --arg pkgs 'import <nixpkgs> {}' --arg src ./. --argstr system ${system} --arg graphJsonPath ${graphJsonPath} --no-link --print-out-paths`;
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

test("cpp: shared lib links direct link_deps (build)", async () => {
  await runInTemp("cpp-shared-lib-direct-link-deps", async (tmp, $) => {
    await fs.outputFile(
      path.join(tmp, "projects", "libs", "support", "src", "support.cpp"),
      ["int support_answer() { return 3; }", ""].join("\n"),
      "utf8",
    );
    await fs.outputFile(
      path.join(tmp, "projects", "libs", "core", "src", "core.cpp"),
      ["extern int support_answer();", "int core_answer() { return support_answer(); }", ""].join(
        "\n",
      ),
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
    ];
    const graphJsonPath = path.join(tmp, ".viberoots", "workspace", "buck", "graph.json");
    await fs.outputFile(graphJsonPath, JSON.stringify(graph, null, 2) + "\n", "utf8");

    const outPath = await nixBuildSelected({
      tmp,
      $,
      graphJsonPath,
      target: "//projects/libs/core:core",
    });
    const log = await fs.readFile(path.join(outPath, "build.log"), "utf8");
    const linkLibs = extractBuildLogLine(log, "link_libs");
    assert.ok(linkLibs, `expected build.log to include link_libs=...; got:\n${log}`);
    assert.equal(linkLibs.trim(), `-l${sanitizeName("//projects/libs/support:support")}`);
  });
});
