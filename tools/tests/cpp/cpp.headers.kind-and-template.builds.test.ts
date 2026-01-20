#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { runInTemp } from "../lib/test-helpers";
import { sanitizeAttrNameFromLabel } from "../../lib/labels";

function parseOutPath(stdout: unknown): string {
  const lines = String(stdout || "")
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return lines[lines.length - 1] || "";
}

await runInTemp("cpp-headers-builds", async (tmp, $) => {
  const repo = process.cwd();

  // Sanity check: macro exists in this workspace revision.
  const defs = await fsp.readFile(path.join(repo, "cpp", "defs.bzl"), "utf8");
  assert.ok(defs.includes("def nix_cpp_headers("), "expected nix_cpp_headers macro to exist");

  await fsp.mkdir(path.join(tmp, "libs", "demo", "include"), { recursive: true });
  await fsp.writeFile(
    path.join(tmp, "libs", "demo", "include", "demo.h"),
    ["#pragma once", "", "inline int demo_answer() { return 42; }", ""].join("\n"),
    "utf8",
  );

  await fsp.mkdir(path.join(tmp, "tools", "buck"), { recursive: true });
  const label = "//libs/demo:demo_headers";
  const attrSuffix = sanitizeAttrNameFromLabel(label);
  await fsp.writeFile(
    path.join(tmp, "tools", "buck", "graph.json"),
    JSON.stringify(
      [
        {
          name: label,
          rule_type: "planner_stub",
          labels: ["lang:cpp", "kind:headers"],
          srcs: ["libs/demo/include/demo.h"],
          deps: [],
        },
      ],
      null,
      2,
    ) + "\n",
    "utf8",
  );

  const flakeGraphGen = path.join(repo, "tools", "nix", "graph-generator.nix");
  const res = await $({
    cwd: tmp,
    stdio: "pipe",
    reject: false,
    nothrow: true,
  })`nix build --impure --accept-flake-config --file ${flakeGraphGen} --arg pkgs 'import <nixpkgs> {}' --arg src ./. --arg graphJsonPath ./tools/buck/graph.json --no-link --print-out-paths cppTargetsFlat.${attrSuffix}`;
  assert.equal(res.exitCode, 0, String(res.stderr || res.stdout));

  const outPath = parseOutPath(res.stdout);
  assert.ok(outPath, "expected nix build to print an output path");
  const hdr = path.join(outPath, "include", "demo.h");
  await fsp.access(hdr);
});
