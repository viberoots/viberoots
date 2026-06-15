#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { validateStartupWorkspaceState } from "../../dev/startup-check/workspace-state";

async function workspace(prefix: string): Promise<string> {
  const root = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), `${prefix}-`)));
  await fsp.writeFile(path.join(root, "flake.nix"), "{ outputs = _: {}; }\n", "utf8");
  await fsp.writeFile(path.join(root, ".buckroot"), ".\n", "utf8");
  await fsp.writeFile(
    path.join(root, ".buckconfig"),
    "[cells]\nprelude = ./prelude\n[repositories]\nprelude = ./prelude\n",
    "utf8",
  );
  await fsp.mkdir(path.join(root, "prelude"), { recursive: true });
  await fsp.writeFile(path.join(root, "prelude", "prelude.bzl"), "# prelude\n", "utf8");
  return root;
}

test("startup-check strict extraction blocker mode fails on old root layout", async () => {
  const root = await workspace("vbr-startup-extraction");
  const oldCwd = process.cwd();
  const oldStrict = process.env.VIBEROOTS_STRICT_EXTRACTION_BLOCKERS;
  try {
    await fsp.mkdir(path.join(root, "build-tools"), { recursive: true });
    process.chdir(root);
    process.env.VIBEROOTS_STRICT_EXTRACTION_BLOCKERS = "1";

    await assert.rejects(validateStartupWorkspaceState(), (e) => {
      assert.match(String((e as Error).message), /extraction old-layout blockers remain/);
      assert.match(String((e as Error).message), /path: build-tools/);
      return true;
    });
  } finally {
    process.chdir(oldCwd);
    if (oldStrict === undefined) delete process.env.VIBEROOTS_STRICT_EXTRACTION_BLOCKERS;
    else process.env.VIBEROOTS_STRICT_EXTRACTION_BLOCKERS = oldStrict;
    await fsp.rm(root, { recursive: true, force: true });
  }
});
