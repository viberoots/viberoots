#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { computeMissingOutputs } from "../../buck/prebuild/presence";

test("prebuild presence accepts active .viberoots current prelude", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "prebuild-current-prelude-"));
  const cwd = process.cwd();
  try {
    const prelude = path.join(root, ".viberoots", "current", "prelude");
    await fsp.mkdir(prelude, { recursive: true });
    await fsp.writeFile(path.join(prelude, "prelude.bzl"), "# test prelude\n", "utf8");
    process.chdir(root);

    assert.deepEqual(await computeMissingOutputs([]), []);
  } finally {
    process.chdir(cwd);
    await fsp.rm(root, { recursive: true, force: true }).catch(() => {});
  }
});
