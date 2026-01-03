#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { runInTemp } from "../lib/test-helpers";
import { DEFAULT_GRAPH_PATH } from "../../lib/graph-const.ts";

test("planner imports plugins listed in langs.json when present", async () => {
  await runInTemp("planner-manifest-plugin", async (tmp, $) => {
    // Write minimal langs.json with a toy language plus go for compatibility
    const langs = {
      enabled: ["go", "toy"],
      languages: [
        {
          id: "go",
          displayName: "Go",
          requiredPaths: ["tools/nix/templates/go.nix", "go/defs.bzl"],
          kinds: ["cli", "lib", "test"],
          templatesDir: "tools/scaffolding/templates/go",
        },
        {
          id: "toy",
          displayName: "Toy",
          requiredPaths: ["tools/nix/planner/toy.nix"],
          kinds: ["lib"],
          templatesDir: "tools/scaffolding/templates/toy",
        },
      ],
    } as any;
    await fs.outputFile(
      path.join(tmp, "tools/nix/langs.json"),
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
    await fs.outputFile(path.join(tmp, "tools/nix/planner/toy.nix"), toyPlugin);

    // Minimal graph.json (empty) so planner evaluates without needing Buck
    await fs.outputFile(path.join(tmp, DEFAULT_GRAPH_PATH), "[]\n");
    await $({
      cwd: tmp,
      stdio: "pipe",
    })`git add tools/nix/langs.json tools/nix/planner/toy.nix tools/buck/graph.json`;

    // Nix build should succeed and produce graph-generator output
    const { stdout } = await $({
      cwd: tmp,
      stdio: "pipe",
    })`nix build ${`path:${tmp}#graph-generator`} --no-link --print-out-paths --accept-flake-config`;
    const outPath =
      String(stdout || "")
        .trim()
        .split("\n")
        .filter(Boolean)
        .pop() || "";
    const manifestPath = path.join(outPath, "manifest.json");
    assert.ok(await fs.pathExists(manifestPath), "manifest.json should exist");
  });
});
