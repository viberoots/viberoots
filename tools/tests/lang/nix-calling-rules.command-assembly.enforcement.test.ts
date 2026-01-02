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
  const cpp = await read("cpp/private/nix_build.bzl");
  const wasm = await read("go/private/nix_build_wasm.bzl");

  for (const [label, src] of [
    ["cpp/private/nix_build.bzl", cpp],
    ["go/private/nix_build_wasm.bzl", wasm],
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
      "nix_build_out_path_cmd(",
      `${label}: expected nix build out path capture to route through nix_build_out_path_cmd(...)`,
    );
    assertContains(
      src,
      'load("//lang:nix_shell.bzl"',
      `${label}: expected nix shell helpers to be loaded from //lang:nix_shell.bzl`,
    );
  }
});
