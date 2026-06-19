#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";

const SKIP_DIRS = new Set([".git", "buck-out", "coverage", "node_modules", "result"]);

async function listBzlFilesUnder(rootDir: string, relDir = ""): Promise<string[]> {
  const absDir = path.join(rootDir, relDir);
  const entries = await fsp.readdir(absDir, { withFileTypes: true });

  const out: string[] = [];
  for (const ent of entries) {
    const rel = path.join(relDir, ent.name);
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) continue;
      out.push(...(await listBzlFilesUnder(rootDir, rel)));
      continue;
    }
    if (ent.isFile() && rel.endsWith(".bzl")) out.push(rel);
  }
  return out;
}

test("no removed mutating wiring helpers are referenced outside //viberoots/build-tools/lang/*", async () => {
  const rootDir = process.cwd();
  const bzlFiles = await listBzlFilesUnder(rootDir);

  for (const file of bzlFiles) {
    if (file.startsWith(`lang${path.sep}`)) continue;
    const txt = await fsp.readFile(file, "utf8");
    assert.ok(
      !txt.includes("_legacy_mutating"),
      `${file} must not reference *_legacy_mutating helpers; use @viberoots//build-tools/lang shared wiring helpers instead`,
    );
  }
});
