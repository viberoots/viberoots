#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("ensure_single_lockfile_label rejects labels missing '#<importer>' suffix (stable error text)", async () => {
  await runInTemp("lockfile-label-missing-importer-suffix", async (tmp, $) => {
    const dir = path.join(tmp, "projects", "apps", "web");
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(
      path.join(dir, "TARGETS"),
      [
        'load("//build-tools/node:defs.bzl", "node_webapp")',
        "",
        "node_webapp(",
        '  name = "bundle",',
        '  labels = ["lang:node", "kind:app", "lockfile:projects/apps/web/pnpm-lock.yaml"],',
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

    assert.notEqual(
      res.exitCode,
      0,
      "expected buck2 build to fail when lockfile label is malformed",
    );
    const combined = String(res.stderr || "") + String(res.stdout || "");
    assert.ok(
      combined.includes("missing '#<importer>'"),
      `expected error to mention missing importer suffix; got:\n${combined}`,
    );
    assert.ok(
      combined.includes("lockfile:<path>#<importer>"),
      `expected error to mention required shape; got:\n${combined}`,
    );
  });
});
