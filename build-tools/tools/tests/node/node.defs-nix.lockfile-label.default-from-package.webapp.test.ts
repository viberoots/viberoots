#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("node_webapp defaults lockfile label from package path", async () => {
  await runInTemp("node-defs-nix-lockfile-default-webapp", async (tmp, $) => {
    const dir = path.join(tmp, "projects", "apps", "web");
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n", "utf8");
    await fsp.writeFile(
      path.join(dir, "TARGETS"),
      [
        'load("@viberoots//build-tools/node:defs.bzl", "node_webapp")',
        "",
        "node_webapp(",
        '  name = "web",',
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
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute labels //projects/apps/web:web`;
    assert.equal(
      res.exitCode,
      0,
      `expected cquery to succeed, got ${res.exitCode}: ${String(res.stderr || "")}`,
    );
    const out = String(res.stdout || "");
    assert.match(
      out,
      /lockfile:projects\/apps\/web\/pnpm-lock\.yaml#projects\/apps\/web/,
      "expected default lockfile label derived from package path",
    );
  });
});
