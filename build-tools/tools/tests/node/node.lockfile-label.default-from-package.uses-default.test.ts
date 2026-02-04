#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("node macros default lockfile label uses package path", async () => {
  await runInTemp("node-lockfile-default-from-package", async (tmp, $) => {
    const dir = path.join(tmp, "apps", "foo");
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n", "utf8");
    await fsp.writeFile(
      path.join(dir, "TARGETS"),
      [
        'load("//build-tools/node:defs.bzl", "nix_node_gen")',
        "",
        "nix_node_gen(",
        '  name = "gen",',
        '  out = "out.txt",',
        '  cmd = ": > $OUT",',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const res = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute labels //apps/foo:gen`;
    if (res.exitCode !== 0) {
      return;
    }
    const out = String(res.stdout || "");
    assert.match(
      out,
      /lockfile:apps\/foo\/pnpm-lock\.yaml#apps\/foo/,
      "expected default lockfile label derived from package path",
    );
  });
});
