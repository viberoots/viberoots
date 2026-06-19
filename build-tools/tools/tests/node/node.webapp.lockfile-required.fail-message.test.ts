#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("node_webapp defaults lockfile label and fails fast when missing", async () => {
  await runInTemp("node-webapp-lockfile-required", async (tmp, $) => {
    const dir = path.join(tmp, "projects", "apps", "web");
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(
      path.join(dir, "TARGETS"),
      [
        'load("@viberoots//build-tools/node:defs.bzl", "node_webapp")',
        "",
        "node_webapp(",
        '  name = "bundle",',
        // Intentionally omit any lockfile:<path>#<importer> label
        '  labels = ["lang:node", "kind:app"],',
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
    })`buck2 build //projects/apps/web:bundle`;

    // Expect failure with targeted missing lockfile error from defaulting path
    assert.notEqual(res.exitCode, 0, "expected buck2 build to fail when lockfile label is missing");
    const combined = String(res.stderr || "") + String(res.stdout || "");
    assert.ok(
      combined.includes(
        "node_webapp: missing lockfile at projects/apps/web/pnpm-lock.yaml. Provide lockfile_label or create projects/apps/web/pnpm-lock.yaml.",
      ),
      "expected targeted missing lockfile error",
    );
  });
});
