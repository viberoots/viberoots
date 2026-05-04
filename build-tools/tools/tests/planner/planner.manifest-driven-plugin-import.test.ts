#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { runInTemp } from "../lib/test-helpers";
import { DEFAULT_GRAPH_PATH } from "../../lib/graph-const";

test("planner imports plugins listed in langs.json when present", async () => {
  await runInTemp("planner-manifest-plugin", async (tmp, $) => {
    // Write minimal langs.json with a toy language plus go for compatibility
    const langs = {
      enabled: ["go", "toy"],
      languages: [
        {
          id: "go",
          displayName: "Go",
          requiredPaths: ["build-tools/tools/nix/templates/go.nix", "build-tools/go/defs.bzl"],
          kinds: ["cli", "lib", "test"],
          templatesDir: "build-tools/tools/scaffolding/templates/go",
        },
        {
          id: "toy",
          displayName: "Toy",
          requiredPaths: ["build-tools/tools/nix/planner/toy.nix"],
          kinds: ["lib"],
          templatesDir: "build-tools/tools/scaffolding/templates/toy",
        },
      ],
    } as any;
    await fs.outputFile(
      path.join(tmp, "build-tools/tools/nix/langs.json"),
      JSON.stringify(langs, null, 2) + "\n",
    );

    // Provide a minimal planner plugin for toy that won't be exercised
    const toyPlugin = [
      "{ lib }:",
      "ctx:",
      "let",
      "  T = ctx.T;",
      "  get = ctx.get;",
      "in {",
      "  isTarget = n: false;",
      "  kindOf = n: null;",
      "  modulesFileFor = name: ctx.modulesTomlFor name;",
      "  mkApp = name: T.goApp { inherit name; modulesToml = ctx.modulesTomlFor name; repoRoot = ctx.repoRoot; subdir = (ctx.pkgPathOf name); };",
      "  mkLib = name: T.goLib { inherit name; modulesToml = ctx.modulesTomlFor name; repoRoot = ctx.repoRoot; subdir = (ctx.pkgPathOf name); };",
      "}",
      "",
    ].join("\n");
    await fs.outputFile(path.join(tmp, "build-tools/tools/nix/planner/toy.nix"), toyPlugin);

    // Minimal graph.json (empty) so planner evaluates without needing Buck
    await fs.outputFile(path.join(tmp, DEFAULT_GRAPH_PATH), "[]\n");
    await $({
      cwd: tmp,
      stdio: "pipe",
    })`git add build-tools/tools/nix/langs.json build-tools/tools/nix/planner/toy.nix build-tools/tools/buck/graph.json`;

    // Eval-only check against planner/langs.nix so we avoid graph-generator/full-flake work.
    const manifestBase = JSON.stringify(path.join(tmp, "build-tools/tools/nix"));
    const expr = `
let
  pkgs = import <nixpkgs> {};
  lib = pkgs.lib;
  manifestBase = builtins.toPath ${manifestBase};
  get = node: key: null;
  ctx = {
    T = {};
    get = get;
    modulesTomlFor = name: "mods.toml";
    repoRoot = ".";
    pkgPathOf = name: ".";
  };
  T = {
    goApp = args: args;
    goLib = args: args;
  };
  M = {};
  langs = import (manifestBase + "/planner/langs.nix") {
    inherit lib manifestBase;
    nodesList = [];
    ctx = ctx;
    get = get;
    T = T;
    M = M;
  };
in builtins.attrNames langs.LANGS
`;
    const { stdout } = await $({
      cwd: tmp,
      stdio: "pipe",
    })`nix eval --json --impure --expr ${expr}`;
    const langIds = JSON.parse(String(stdout || "[]")) as string[];
    assert.ok(langIds.includes("toy"), `expected LANGS to include toy, got: ${langIds.join(",")}`);
  });
});
