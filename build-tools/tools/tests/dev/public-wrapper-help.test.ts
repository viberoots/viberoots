#!/usr/bin/env zx-wrapper
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

const execFileAsync = promisify(execFile);
const thisDir = path.dirname(fileURLToPath(import.meta.url));
const binDir = path.resolve(thisDir, "..", "..", "bin");
const repoRoot = path.resolve(thisDir, "..", "..", "..", "..");

const cases = [
  { name: "vbr", usage: "viberoots commands:" },
  { name: "viberoots", usage: "viberoots commands:" },
  { name: "i", usage: "usage: i [options]" },
  { name: "install-deps", usage: "usage: i [options]" },
  { name: "b", usage: "usage: b [buck-subcommand|target...] [options]" },
  { name: "build", usage: "usage: b [buck-subcommand|target...] [options]" },
  { name: "v", usage: "usage: v [options] [target...]" },
  { name: "verify", usage: "usage: v [options] [target...]" },
];

for (const entry of cases) {
  test(`${entry.name} --help is help-only`, async () => {
    const missingSource = path.join(repoRoot, "missing-viberoots-source-for-help-test");
    const { stdout, stderr } = await execFileAsync(path.join(binDir, entry.name), ["--help"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        WORKSPACE_ROOT: repoRoot,
        VIBEROOTS_ROOT: missingSource,
        VIBEROOTS_SOURCE_ROOT: missingSource,
      },
    });

    assert.match(stdout, new RegExp(entry.usage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(stdout, /viberoots (install|build|verify)/);
    if (entry.name === "vbr" || entry.name === "viberoots") {
      assert.doesNotMatch(stdout, /source mode:/);
      assert.match(stdout, /viberoots status \[--json\]/);
    }
    assert.doesNotMatch(stderr, /No such file or directory|devshell\.sh/);
  });
}
