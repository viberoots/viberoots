#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("node_webapp requires exactly one importer-scoped lockfile label (shared error text)", async () => {
  await runInTemp("node-webapp-lockfile-required", async (tmp, $) => {
    const dir = path.join(tmp, "apps", "web");
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(
      path.join(dir, "TARGETS"),
      [
        'load("//node:defs.bzl", "node_webapp")',
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
    })`buck2 build //apps/web:bundle`;

    // Expect failure with shared, stable error text from ensure_single_lockfile_label
    assert.notEqual(res.exitCode, 0, "expected buck2 build to fail when lockfile label is missing");
    const combined = String(res.stderr || "") + String(res.stdout || "");
    assert.ok(
      combined.includes(
        "Exactly one importer-scoped lockfile label is required (lockfile:<path>#<importer>)",
      ),
      "expected shared error message for missing importer-scoped lockfile label",
    );
  });
});
