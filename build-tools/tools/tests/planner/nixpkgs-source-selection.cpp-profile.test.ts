#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { pinnedNixpkgsOutPathExpr } from "../../lib/pinned-nixpkgs";
import { runInScratchTemp } from "../lib/test-helpers";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

function parseOutPath(stdout: unknown): string {
  return (
    String(stdout || "")
      .trim()
      .split("\n")
      .filter(Boolean)
      .pop() || ""
  );
}

async function runBuiltBinary($: any, outPath: string): Promise<string> {
  const names = await fs.readdir(path.join(outPath, "bin"));
  assert.ok(names.length > 0, `no binary found under ${outPath}/bin`);
  const res = await $({ stdio: "pipe" })`${path.join(outPath, "bin", names[0])}`;
  return String(res.stdout || "").trim();
}

async function pinnedNixpkgsPath($: any): Promise<string> {
  const expr = pinnedNixpkgsOutPathExpr(path.join(sourceRoot, "flake.lock"));
  const out = await $({
    stdio: "pipe",
  })`nix eval --impure --accept-flake-config --raw --expr ${expr}`;
  return String(out.stdout || "").trim();
}

async function writeFixture(root: string, nixpkgsPath: string): Promise<void> {
  await fs.outputFile(
    path.join(root, "projects", "apps", "demo", "src", "main.cpp"),
    [
      "#include <profile_probe.h>",
      "#include <cstdio>",
      "int main() {",
      '  std::printf("profile=%d\\n", PROFILE_PROBE_VALUE);',
      "  return 0;",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.outputFile(
    path.join(root, ".viberoots", "workspace", "buck", "graph.json"),
    JSON.stringify(
      [
        {
          name: "//projects/apps/demo:demo",
          rule_type: "cxx_binary",
          labels: ["lang:cpp", "kind:bin", "nixpkg:pkgs.profileProbe"],
          srcs: ["src/main.cpp"],
          nixpkgs_profile: "alt",
          nixpkg_pins: {},
        },
      ],
      null,
      2,
    ) + "\n",
    "utf8",
  );
  await fs.outputFile(
    path.join(root, "fake-alt-nixpkgs", "default.nix"),
    [
      "{ system, ... }:",
      "let",
      `  base = import ${nixpkgsPath} { inherit system; };`,
      "in base // {",
      "  profileprobe = base.writeTextDir \"include/profile_probe.h\" ''",
      "    #pragma once",
      "    #define PROFILE_PROBE_VALUE 42",
      "  '';",
      "  stdenv = base.stdenv // {",
      "    mkDerivation = args: base.stdenv.mkDerivation (args // {",
      '      passthru = (args.passthru or {}) // { selectedNixpkgsProfileForTest = "alt"; };',
      "    });",
      "  };",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.outputFile(
    path.join(root, "alt-registry.nix"),
    [
      "{ ... }: {",
      '  schemaVersion = "nixpkgs-source-registry@1";',
      "  profiles.default = { supportedSystems = [ ]; };",
      "  profiles.alt = {",
      "    input = ./fake-alt-nixpkgs;",
      '    rationale = "test alternate profile";',
      "    supportedSystems = [ ];",
      "  };",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
}

async function writeBuildExpr(tmp: string, nixpkgsPath: string): Promise<string> {
  const graphGenerator = path.join(
    sourceRoot,
    "build-tools",
    "tools",
    "nix",
    "graph-generator.nix",
  );
  const expr = path.join(tmp, "selected-profile-build.nix");
  await fs.writeFile(
    expr,
    [
      "{ src }:",
      "let",
      `  pkgs = import ${nixpkgsPath} {};`,
      `  graphGenerator = import ${graphGenerator};`,
      "in (graphGenerator {",
      "  inherit pkgs src;",
      '  graphJsonPath = src + "/.viberoots/workspace/buck/graph.json";',
      '  nixpkgsRegistry = import (src + "/alt-registry.nix") {};',
      '  nixpkgsRegistryPath = src + "/alt-registry.nix";',
      "}).selected",
      "",
    ].join("\n"),
    "utf8",
  );
  return expr;
}

async function buildSelected($: any, cwd: string, expr: string, src: string, filtered: boolean) {
  return await $({
    cwd,
    stdio: "pipe",
    env: {
      ...process.env,
      BUCK_TARGET: "//projects/apps/demo:demo",
      ...(filtered ? { VBR_FILTERED_FLAKE_SNAPSHOT: "1" } : {}),
    },
  })`nix build --impure -L --expr ${`import ${expr} { src = ${src}; }`} --no-link --print-out-paths`;
}

test("selected C++ builds use target nixpkgs_profile for stdenv and nixpkg attrs", async () => {
  await runInScratchTemp("nixpkgs-profile-cpp-selected", async (tmp, $) => {
    const nixpkgsPath = await pinnedNixpkgsPath($);
    await writeFixture(tmp, nixpkgsPath);
    const snapshot = path.join(path.dirname(tmp), `${path.basename(tmp)}-filtered`);
    await fs.copy(tmp, snapshot);
    const expr = await writeBuildExpr(tmp, nixpkgsPath);

    const local = await buildSelected($, tmp, expr, "./.", false);
    const localOut = parseOutPath(local.stdout);
    const localBuildLog = await fs.readFile(path.join(localOut, "build.log"), "utf8");
    assert.match(localBuildLog, /^nixpkgsProfile=alt$/m);
    assert.equal(await runBuiltBinary($, localOut), "profile=42");

    const marker = await $({
      cwd: tmp,
      stdio: "pipe",
      env: { ...process.env, BUCK_TARGET: "//projects/apps/demo:demo" },
    })`nix eval --impure --raw --expr ${`(import ${expr} { src = ./.; }).selectedNixpkgsProfileForTest`}`;
    assert.equal(String(marker.stdout || "").trim(), "alt");

    const filtered = await buildSelected($, tmp, expr, snapshot, true);
    assert.equal(await runBuiltBinary($, parseOutPath(filtered.stdout)), "profile=42");
  });
});
