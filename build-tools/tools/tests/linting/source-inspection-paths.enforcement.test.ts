#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { VIBEROOTS_SOURCE_ROOT } from "../lib/test-helpers/source-paths";

const TEST_ROOT = path.join(VIBEROOTS_SOURCE_ROOT, "build-tools/tools/tests");

const EXCLUDED_REL_PATHS = new Set([
  // This test intentionally embeds a forbidden raw-read fixture string.
  "ci/tooling-contract.denies-raw-read.test.ts",
]);

const FORBIDDEN_PATTERNS: Array<{ re: RegExp; label: string }> = [
  {
    re: /\b(?:\w+\.)?readFile(?:Sync)?\(\s*["']viberoots\//,
    label: "direct readFile/readFileSync of viberoots/...",
  },
  {
    re: /\b(?:\w+\.)?readFile(?:Sync)?\(\s*path\.join\(process\.cwd\(\),\s*["']viberoots\//,
    label: "readFile/readFileSync through process.cwd()",
  },
  {
    re: /\bpath\.join\(process\.cwd\(\),\s*["']viberoots\//,
    label: "process.cwd() source path",
  },
];

async function collectTestFiles(dir: string): Promise<string[]> {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTestFiles(abs)));
    } else if (entry.isFile() && abs.endsWith(".ts")) {
      files.push(abs);
    }
  }
  return files;
}

test("source-inspection tests resolve viberoots source independent of CWD", async () => {
  const violations: string[] = [];
  for (const abs of await collectTestFiles(TEST_ROOT)) {
    const rel = path.relative(TEST_ROOT, abs).replaceAll(path.sep, "/");
    if (EXCLUDED_REL_PATHS.has(rel)) continue;

    const lines = (await fsp.readFile(abs, "utf8")).split("\n");
    lines.forEach((line, index) => {
      for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.re.test(line)) {
          violations.push(`${rel}:${index + 1}: ${pattern.label}`);
        }
      }
    });
  }

  assert.deepEqual(
    violations,
    [],
    [
      "Source-inspection tests must use viberootsSourcePath(...) from",
      "build-tools/tools/tests/lib/test-helpers/source-paths.ts.",
      "The helper is anchored to the checked-out viberoots tree via import.meta.url,",
      "so tests work from the consumer root, the source checkout, and temp copies.",
      ...violations,
    ].join("\n"),
  );
});
