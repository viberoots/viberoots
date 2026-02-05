#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("node macros default lockfile label fails fast when missing", async () => {
  await runInTemp("node-lockfile-default-missing", async (tmp, $) => {
    const dir = path.join(tmp, "projects", "apps", "bar");
    await fsp.mkdir(dir, { recursive: true });
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
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute name //projects/apps/bar:gen`;

    assert.notEqual(
      res.exitCode,
      0,
      "expected buck2 cquery to fail when the default lockfile is missing",
    );
    const combined = String(res.stderr || "") + String(res.stdout || "");
    assert.ok(
      combined.includes(
        "nix_node_gen: missing lockfile at projects/apps/bar/pnpm-lock.yaml. Provide lockfile_label or create projects/apps/bar/pnpm-lock.yaml.",
      ),
      "expected a targeted missing lockfile error",
    );
  });
});
