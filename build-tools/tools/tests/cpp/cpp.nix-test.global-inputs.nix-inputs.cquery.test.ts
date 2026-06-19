#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

test("nix_cpp_test passes global Nix inputs through cpp_nix_test(nix_inputs)", async () => {
  await runInTemp("cpp-nix-test-global-inputs", async (tmp, $) => {
    const dir = path.join(tmp, "viberoots", "build-tools", "cpp", "t");
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(
      path.join(dir, "TARGETS"),
      [
        'load("@viberoots//build-tools/cpp:defs.bzl", "nix_cpp_test")',
        "",
        "nix_cpp_test(",
        '  name = "t",',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const probe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute nix_inputs //viberoots/build-tools/cpp/t:t`;
    if (probe.exitCode !== 0) return;
    const out = String(probe.stdout || "");
    assert.ok(
      out.includes(":flake.lock"),
      "expected //.viberoots/workspace:flake.lock to be present in nix_inputs via global_nix_inputs()",
    );
    assert.ok(
      includesAny(out, [
        "@viberoots//build-tools/tools/dev:runtime_ts",
        "viberoots//build-tools/tools/dev:runtime_ts",
        "root//viberoots/build-tools/tools/dev:runtime_ts",
      ]),
      "expected selected-build runtime filegroup to be present in nix_inputs",
    );
    assert.ok(
      includesAny(out, [
        "@viberoots//build-tools/tools/nix:runtime_nix",
        "viberoots//build-tools/tools/nix:runtime_nix",
        "root//viberoots/build-tools/tools/nix:runtime_nix",
      ]),
      "expected planner runtime filegroup to be present in nix_inputs",
    );
  });
});
