#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("node_webapp default lockfile label fails fast when missing", async () => {
  await runInTemp("node-defs-nix-lockfile-default-missing", async (tmp, $) => {
    const dir = path.join(tmp, "apps", "missing");
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(
      path.join(dir, "TARGETS"),
      [
        'load("//build-tools/node:defs.bzl", "node_webapp")',
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
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute name //apps/missing:web`;

    assert.notEqual(
      res.exitCode,
      0,
      "expected buck2 cquery to fail when the default lockfile is missing",
    );
    const combined = String(res.stderr || "") + String(res.stdout || "");
    assert.ok(
      combined.includes(
        "node_webapp: missing lockfile at apps/missing/pnpm-lock.yaml. Provide lockfile_label or create apps/missing/pnpm-lock.yaml.",
      ),
      "expected a targeted missing lockfile error",
    );
  });
});
