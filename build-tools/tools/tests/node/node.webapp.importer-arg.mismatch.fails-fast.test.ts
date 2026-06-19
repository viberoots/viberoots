#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("node_webapp fails fast when importer argument disagrees with lockfile_label importer", async () => {
  await runInTemp("node-webapp-importer-arg-mismatch", async (tmp, $) => {
    const importerDir = path.join(tmp, "projects", "apps", "demo");
    await fsp.mkdir(importerDir, { recursive: true });
    await fsp.writeFile(path.join(importerDir, "pnpm-lock.yaml"), "lockfileVersion: 9\n", "utf8");

    await fsp.writeFile(
      path.join(importerDir, "TARGETS"),
      [
        'load("@viberoots//build-tools/node:defs.bzl", "node_webapp")',
        "",
        "node_webapp(",
        '  name = "bundle",',
        '  lockfile_label = "lockfile:projects/apps/demo/pnpm-lock.yaml#projects/apps/demo",',
        '  importer = "projects/apps/other",',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const q = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute name //projects/apps/demo:bundle`;

    assert.notEqual(q.exitCode, 0, "expected cquery to fail on importer mismatch");
    const combined = String(q.stderr || "") + String(q.stdout || "");
    assert.ok(
      combined.includes("node_webapp: importer must match"),
      `expected deterministic importer mismatch guidance, got:\n${combined}`,
    );
  });
});
