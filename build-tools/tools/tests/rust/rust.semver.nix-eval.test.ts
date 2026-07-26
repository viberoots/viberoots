#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";

test("Rust composition evaluates Cargo version requirement grammar", () => {
  const cases: Array<[string, string, boolean]> = [
    ["1.2", "1.9.0", true],
    ["1.2", "2.0.0", false],
    ["^0.2.3", "0.2.9", true],
    ["^0.2.3", "0.3.0", false],
    ["^0.0.3", "0.0.4", false],
    ["~1.2", "1.2.9", true],
    ["~1.2", "1.3.0", false],
    ["1.*", "1.8.0", true],
    ["1.2.x", "1.3.0", false],
    ["=1.2", "1.2.8", true],
    [">=1.2, <2", "1.9.9", true],
    [">=1.2, <2", "2.0.0", false],
    [">1.2", "1.2.9", false],
    ["<=1.2", "1.2.9", true],
    ["^1.2.3-alpha.1", "1.2.3-alpha.2", true],
    ["^1.2.3", "1.3.0-alpha.1", false],
  ];
  const rendered = cases
    .map(
      ([requirement, version, expected]) =>
        `{ requirement = ${JSON.stringify(requirement)}; version = ${JSON.stringify(version)}; expected = ${
          expected ? "true" : "false"
        }; }`,
    )
    .join("\n");
  const sourceRoot =
    path.basename(process.cwd()) === "viberoots"
      ? process.cwd()
      : path.join(process.cwd(), "viberoots");
  const module = path.join(sourceRoot, "build-tools/tools/nix/planner/rust-semver.nix");
  const expr = `
    let
      pkgs = import <nixpkgs> {};
      semver = import ${JSON.stringify(module)} { inherit (pkgs) lib; };
      cases = [ ${rendered} ];
    in map (case: {
      inherit (case) requirement version expected;
      actual = semver.versionCompatible case.requirement case.version;
    }) cases
  `;
  const evaluated = JSON.parse(
    execFileSync("nix", ["eval", "--impure", "--expr", expr, "--json"], {
      encoding: "utf8",
    }),
  ) as Array<{
    actual: boolean;
    expected: boolean;
    requirement: string;
    version: string;
  }>;
  for (const item of evaluated) {
    assert.equal(item.actual, item.expected, `${item.requirement} against ${item.version}`);
  }
});
