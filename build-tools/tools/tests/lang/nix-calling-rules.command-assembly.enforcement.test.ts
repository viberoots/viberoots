#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

async function read(p: string): Promise<string> {
  return await fsp.readFile(p, "utf8");
}

function assertDoesNotContain(haystack: string, needle: string, msg: string) {
  assert.ok(!haystack.includes(needle), msg);
}

function assertContains(haystack: string, needle: string, msg: string) {
  assert.ok(haystack.includes(needle), msg);
}

function assertNoLineMatches(haystack: string, re: RegExp, msg: string) {
  assert.ok(!re.test(haystack), msg);
}

test("Nix-calling rule implementations use shared nix out-path capture helpers and do not mask failures", async () => {
  const cpp = await read("viberoots/build-tools/cpp/private/nix_build.bzl");
  const wasm = await read("viberoots/build-tools/go/private/nix_build_wasm.bzl");

  for (const [label, src] of [
    ["viberoots/build-tools/cpp/private/nix_build.bzl", cpp],
    ["viberoots/build-tools/go/private/nix_build_wasm.bzl", wasm],
  ] as const) {
    assertNoLineMatches(
      src,
      /^[^\n]*\bnix build\b[^\n]*\|\| true[^\n]*$/m,
      `${label}: expected no failure masking with '|| true' on nix build lines`,
    );
    assertDoesNotContain(
      src,
      "OUT_PATH=$(",
      `${label}: expected no hand-rolled out path capture using command substitution`,
    );
    assertDoesNotContain(
      src,
      "--out-link",
      `${label}: expected nix build to avoid --out-link (no GC roots / stale symlinks)`,
    );
    assertContains(
      src,
      'load("@viberoots//build-tools/lang:nix_shell.bzl"',
      `${label}: expected nix shell helpers to be loaded from @viberoots//build-tools/lang:nix_shell.bzl`,
    );
  }

  assertContains(
    wasm,
    "nix_build_out_path_cmd(",
    "viberoots/build-tools/go/private/nix_build_wasm.bzl: expected nix build out path capture to route through nix_build_out_path_cmd(...)",
  );
  assertContains(
    cpp,
    "nix-build-filtered-flake.ts",
    "viberoots/build-tools/cpp/private/nix_build.bzl: expected C++ builds to route through the filtered flake helper",
  );

  assertDoesNotContain(
    wasm,
    "|| true",
    "viberoots/build-tools/go/private/nix_build_wasm.bzl: expected no failure-masking '|| true' patterns; use conditional diagnostics instead",
  );
});
