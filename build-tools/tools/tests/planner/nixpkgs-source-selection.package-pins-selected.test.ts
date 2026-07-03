#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { pinnedNixpkgsOutPathExpr } from "../../lib/pinned-nixpkgs";
import { runInScratchTemp } from "../lib/test-helpers";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const target = "//projects/apps/pins:demo";

function parseOutPath(stdout: unknown): string {
  return (
    String(stdout || "")
      .trim()
      .split("\n")
      .filter(Boolean)
      .pop() || ""
  );
}

async function pinnedNixpkgsPath($: any): Promise<string> {
  const expr = pinnedNixpkgsOutPathExpr(path.join(sourceRoot, "flake.lock"));
  const out = await $({
    stdio: "pipe",
  })`nix eval --impure --accept-flake-config --raw --expr ${expr}`;
  return String(out.stdout || "").trim();
}

async function writeRegistry(root: string, nixpkgsPath: string): Promise<void> {
  await fs.outputFile(
    path.join(root, "fake-alt-nixpkgs", "default.nix"),
    [
      "{ system, ... }:",
      "let",
      `  base = import ${nixpkgsPath} { inherit system; };`,
      "in base // {",
      "  toolbundle = base.runCommand \"toolbundle\" {} ''",
      "    mkdir -p $out/include $out/bin",
      "    printf '%s\\n' '#pragma once' '#define TOOL_BUNDLE_VALUE 7' > $out/include/tool_bundle.h",
      "    printf '%s\\n' '#!/bin/sh' 'echo tool' > $out/bin/toolbundle",
      "    chmod +x $out/bin/toolbundle",
      "  '';",
      "  protobufprotoc = base.writeTextDir \"include/protobuf_mismatch.h\" ''",
      "    #pragma once",
      "    #define GENERATED_PROTOBUF_VERSION 31",
      "  '';",
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

async function writeGraph(root: string, labels: string[], rationale: string): Promise<void> {
  await fs.outputFile(
    path.join(root, ".viberoots", "workspace", "buck", "graph.json"),
    JSON.stringify(
      [
        {
          name: target,
          rule_type: "cxx_binary",
          labels: ["lang:cpp", "kind:bin", ...labels],
          srcs: ["src/main.cpp"],
          nixpkg_pins: {
            [labels[0].replace(/^nixpkg:/, "")]: {
              nixpkgs_profile: "alt",
              rationale,
            },
          },
        },
      ],
      null,
      2,
    ) + "\n",
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
  const expr = path.join(tmp, "selected-pins-build.nix");
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

function buildSelected($: any, cwd: string, expr: string, src: string, filtered = false) {
  return $({
    cwd,
    stdio: "pipe",
    env: {
      ...process.env,
      BUCK_TARGET: target,
      ...(filtered ? { VBR_FILTERED_FLAKE_SNAPSHOT: "1" } : {}),
    },
  })`nix build --impure -L --expr ${`import ${expr} { src = ${src}; }`} --no-link --print-out-paths`;
}

async function runBuiltBinary($: any, outPath: string): Promise<string> {
  const names = await fs.readdir(path.join(outPath, "bin"));
  assert.ok(names.length > 0, `no binary found under ${outPath}/bin`);
  const res = await $({ stdio: "pipe" })`${path.join(outPath, "bin", names[0])}`;
  return String(res.stdout || "").trim();
}

function sourcePlanLines(log: string): string[] {
  return log.split("\n").filter((line) => line.startsWith("nixpkgsSourcePlan="));
}

test("package pins keep tool-and-library packages ordinary and match filtered selected source plans", async () => {
  await runInScratchTemp("nixpkgs-package-pins-selected-parity", async (tmp, $) => {
    const nixpkgsPath = await pinnedNixpkgsPath($);
    await writeRegistry(tmp, nixpkgsPath);
    await fs.outputFile(
      path.join(tmp, "projects", "apps", "pins", "src", "main.cpp"),
      [
        "#include <tool_bundle.h>",
        "#include <zlib.h>",
        "#include <cstdio>",
        "int main() {",
        '  std::printf("tool=%d zlib=%s\\n", TOOL_BUNDLE_VALUE, zlibVersion());',
        "  return 0;",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeGraph(tmp, ["nixpkg:pkgs.toolBundle", "nixpkg:pkgs.zlib"], "Use fixture bundle.");
    const snapshot = path.join(path.dirname(tmp), `${path.basename(tmp)}-filtered`);
    await fs.copy(tmp, snapshot);
    const expr = await writeBuildExpr(tmp, nixpkgsPath);

    const localOut = parseOutPath((await buildSelected($, tmp, expr, "./.")).stdout);
    assert.match(await runBuiltBinary($, localOut), /^tool=7 zlib=/);
    const localPlan = sourcePlanLines(await fs.readFile(path.join(localOut, "build.log"), "utf8"));

    const filteredOut = parseOutPath((await buildSelected($, tmp, expr, snapshot, true)).stdout);
    assert.match(await runBuiltBinary($, filteredOut), /^tool=7 zlib=/);
    const filteredPlan = sourcePlanLines(
      await fs.readFile(path.join(filteredOut, "build.log"), "utf8"),
    );

    assert.deepEqual(filteredPlan, localPlan);
    assert.ok(
      localPlan.includes(
        "nixpkgsSourcePlan=pkgs.toolbundle -> alt (nixpkg_pin; rationale=Use fixture bundle.)",
      ),
    );
    assert.ok(localPlan.includes("nixpkgsSourcePlan=pkgs.zlib -> default (nixpkgs_profile)"));
  });
});

test("protobuf-like mismatched pin reaches normal C++ build failure", async () => {
  await runInScratchTemp("nixpkgs-package-pins-protobuf-mismatch", async (tmp, $) => {
    const nixpkgsPath = await pinnedNixpkgsPath($);
    await writeRegistry(tmp, nixpkgsPath);
    await fs.outputFile(
      path.join(tmp, "projects", "apps", "pins", "src", "main.cpp"),
      [
        "#include <protobuf_mismatch.h>",
        'static_assert(GENERATED_PROTOBUF_VERSION == 32, "protobuf mismatch reached compile");',
        "int main() { return 0; }",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeGraph(
      tmp,
      ["nixpkg:pkgs.protobufProtoc", "nixpkg:pkgs.zlib"],
      "Use fixture protoc package.",
    );
    const expr = await writeBuildExpr(tmp, nixpkgsPath);

    const result = await buildSelected($, tmp, expr, "./.").nothrow();
    const output = `${result.stdout || ""}\n${result.stderr || ""}`;
    assert.notEqual(result.exitCode, 0);
    assert.match(output, /protobuf mismatch reached compile/);
    assert.match(output, /static assertion failed|error:/);
    assert.doesNotMatch(output, /undeclared nixpkg attrs|unknown profile|nixpkg_pins\[.*\]/);
  });
});
