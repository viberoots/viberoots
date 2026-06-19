#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const VIBEROOTS_ROOT = path.join(process.cwd(), "viberoots");

async function walk(dir: string, out: string[]): Promise<void> {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(abs, out);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".test.ts")) continue;
    out.push(abs);
  }
}

test("pkgs__zlib cpp patch references remain temp-scoped in tests", async () => {
  const testsRoot = path.join(VIBEROOTS_ROOT, "build-tools", "tools", "tests");
  const files: string[] = [];
  await walk(testsRoot, files);

  const offenders: string[] = [];
  for (const file of files) {
    const txt = await fsp.readFile(file, "utf8");
    if (!txt.includes("pkgs__zlib")) continue;
    const tempScoped =
      txt.includes("runInTemp(") || txt.includes("mkdtemp(") || txt.includes("path.join(tmp");
    if (tempScoped) continue;
    offenders.push(file);
  }

  assert.deepEqual(
    offenders,
    [],
    `pkgs__zlib references must be created in temp repos only: ${offenders.join(", ")}`,
  );
});
