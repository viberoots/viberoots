#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

async function readUtf8(p: string): Promise<string> {
  return await fsp.readFile(p, "utf8");
}

test("importer roots are not hardcoded in TS/Starlark implementations", async () => {
  const ts = await readUtf8("build-tools/tools/lib/importers.ts");
  const bzl = await readUtf8("lang/lockfile_labels.bzl");

  // TS: previously hardcoded in a single regex; must now be derived from importer-roots contract.
  assert.ok(
    !ts.includes("/^(apps|libs)\\/[^/]+$/"),
    "build-tools/tools/lib/importers.ts must not hardcode importer roots via regex",
  );

  // Starlark: previously hardcoded via startswith checks.
  assert.ok(
    !bzl.includes('startswith("apps/")'),
    "lang/lockfile_labels.bzl must not hardcode apps/ importer roots",
  );
  assert.ok(
    !bzl.includes('startswith("libs/")'),
    "lang/lockfile_labels.bzl must not hardcode libs/ importer roots",
  );
});
