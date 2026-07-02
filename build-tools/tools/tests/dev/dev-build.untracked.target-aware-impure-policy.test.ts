#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import {
  maybeAutoImpureFromUntrackedFiles,
  untrackedRequiresImpureForTargets,
} from "../../dev/dev-build/untracked";
import { runInScratchTemp, runInTemp } from "../lib/test-helpers";

test("target-aware untracked policy ignores unrelated docs/tests paths", () => {
  const r = untrackedRequiresImpureForTargets({
    untracked: [
      "docs/notes.md",
      "viberoots/build-tools/tools/tests/dev/foo.test.ts",
      "viberoots/build-tools/docs/guide.md",
    ],
    targetPackages: ["projects/apps/myapp"],
  });
  assert.equal(r.requiresImpure, false);
  assert.equal(r.relevant.length, 0);
  assert.equal(r.ignored.length, 3);
});

test("target-aware untracked policy marks target package files relevant", () => {
  const r = untrackedRequiresImpureForTargets({
    untracked: ["projects/apps/myapp/src/new.ts"],
    targetPackages: ["projects/apps/myapp"],
  });
  assert.equal(r.requiresImpure, true);
  assert.deepEqual(r.relevant, ["projects/apps/myapp/src/new.ts"]);
});

test("target-aware untracked policy marks global build inputs relevant", () => {
  const r = untrackedRequiresImpureForTargets({
    untracked: ["flake.lock", "viberoots/build-tools/node/defs_nix.bzl"],
    targetPackages: ["projects/apps/myapp"],
  });
  assert.equal(r.requiresImpure, true);
  assert.equal(r.relevant.length, 2);
});

test("auto impure logging is compact in quiet mode", async () => {
  await runInTemp("dev-build-untracked-quiet-log", async (tmp) => {
    await $({ cwd: tmp, stdio: "ignore" })`git init`;
    await fsp.mkdir(`${tmp}/projects/apps/myapp/src`, { recursive: true });
    await fsp.writeFile(`${tmp}/projects/apps/myapp/src/new.ts`, "", "utf8");

    const prevVerbose = process.env.VBR_VERBOSE;
    delete process.env.VBR_VERBOSE;
    const prevWrite = process.stderr.write;
    let stderr = "";
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderr += String(chunk);
      return true;
    }) as typeof process.stderr.write;
    try {
      const result = await maybeAutoImpureFromUntrackedFiles({
        isCI: false,
        root: tmp,
        impure: false,
        subcmd: "build",
        restArgs: ["//projects/apps/myapp:app"],
      });
      assert.equal(result.impure, true);
      assert.match(stderr, /warn\s+impure build due to \d+ relevant untracked file\(s\)/);
      assert.match(stderr, /    - .+/);
      assert.match(stderr, /    - \.\.\. \d+ more/);
      assert.doesNotMatch(stderr, /Falling back to --impure/);
    } finally {
      process.stderr.write = prevWrite;
      if (typeof prevVerbose === "string") process.env.VBR_VERBOSE = prevVerbose;
      else delete process.env.VBR_VERBOSE;
    }
  });
});

test("auto impure logging summarizes generated workspace files in quiet mode", async () => {
  await runInScratchTemp("dev-build-untracked-generated-quiet-log", async (tmp) => {
    await $({ cwd: tmp, stdio: "ignore" })`git init`;
    await fsp.mkdir(`${tmp}/.direnv/bin`, { recursive: true });
    await fsp.mkdir(`${tmp}/projects/config`, { recursive: true });
    await fsp.writeFile(`${tmp}/.buckconfig`, "", "utf8");
    await fsp.writeFile(`${tmp}/.buckroot`, "", "utf8");
    await fsp.writeFile(`${tmp}/.envrc`, "", "utf8");
    await fsp.writeFile(`${tmp}/.direnv/bin/nix-direnv-reload`, "", "utf8");
    await fsp.writeFile(`${tmp}/projects/AGENTS.md`, "", "utf8");
    await fsp.writeFile(`${tmp}/projects/config/shared.json`, "{}\n", "utf8");

    const prevVerbose = process.env.VBR_VERBOSE;
    delete process.env.VBR_VERBOSE;
    const prevWrite = process.stderr.write;
    let stderr = "";
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderr += String(chunk);
      return true;
    }) as typeof process.stderr.write;
    try {
      const result = await maybeAutoImpureFromUntrackedFiles({
        isCI: false,
        root: tmp,
        impure: false,
        subcmd: "build",
        restArgs: ["//..."],
      });
      assert.equal(result.impure, true);
      assert.match(
        stderr,
        /warn\s+impure build due to \d+ generated workspace untracked file\(s\)/,
      );
      assert.doesNotMatch(stderr, /    - \.buckconfig/);
      assert.doesNotMatch(stderr, /    - \.direnv/);
    } finally {
      process.stderr.write = prevWrite;
      if (typeof prevVerbose === "string") process.env.VBR_VERBOSE = prevVerbose;
      else delete process.env.VBR_VERBOSE;
    }
  });
});
