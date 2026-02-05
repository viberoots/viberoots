#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { runInTemp } from "../lib/test-helpers";

function parseOutPath(stdout: unknown): string {
  const lines = String(stdout || "")
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return lines[lines.length - 1] || "";
}

await runInTemp("cpp-headers-consumed-by-template-input", async (tmp, $) => {
  const repo = process.cwd();

  await fsp.mkdir(path.join(tmp, "projects", "libs", "hdrs", "include"), { recursive: true });
  await fsp.writeFile(
    path.join(tmp, "projects", "libs", "hdrs", "include", "hdrs.h"),
    ["#pragma once", "", "inline int hdrs_value() { return 7; }", ""].join("\n"),
    "utf8",
  );

  await fsp.mkdir(path.join(tmp, "projects", "apps", "demo", "src"), { recursive: true });
  await fsp.writeFile(
    path.join(tmp, "projects", "apps", "demo", "src", "main.cpp"),
    ['#include "hdrs.h"', "", "int main() {", "  (void)hdrs_value();", "  return 0;", "}", ""].join(
      "\n",
    ),
    "utf8",
  );

  const expr = [
    "let",
    "  pkgs = import <nixpkgs> {};",
    `  T = import ${JSON.stringify(path.join(repo, "build-tools", "tools", "nix", "templates", "cpp.nix"))} { inherit pkgs; };`,
    `  srcRoot = builtins.toPath ${JSON.stringify(tmp)};`,
    "  hdrs = T.cppHeaders {",
    '    name = "//projects/libs/hdrs:hdrs";',
    "    inherit srcRoot;",
    '    subdir = "projects/libs/hdrs";',
    '    srcList = [ "include/hdrs.h" ];',
    "  };",
    "  app = T.cppApp {",
    '    name = "//projects/apps/demo:demo";',
    "    inherit srcRoot;",
    '    subdir = "projects/apps/demo";',
    '    srcList = [ "src/main.cpp" ];',
    "    nixCxxPkgs = [ hdrs ];",
    "  };",
    "in app",
  ].join("\n");

  const res = await $({
    cwd: tmp,
    stdio: "pipe",
    reject: false,
    nothrow: true,
    env: { ...process.env, PLANNER_ONLY_CPP: "1" },
  })`nix build --impure --accept-flake-config --expr ${expr} --no-link --print-out-paths`;
  assert.equal(res.exitCode, 0, String(res.stderr || res.stdout));

  const outPath = parseOutPath(res.stdout);
  assert.ok(outPath, "expected nix build to print an output path");
  const binDir = path.join(outPath, "bin");
  const entries = await fsp.readdir(binDir);
  assert.ok(entries.length > 0, `expected a binary under ${binDir}`);
});
