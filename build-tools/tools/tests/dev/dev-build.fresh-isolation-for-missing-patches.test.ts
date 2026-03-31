#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { missingOptionalPatchDirsForFreshIsolation } from "../../dev/dev-build/run-dev-build.ts";

test("dev-build uses fresh isolation for full recursive builds when optional patch dirs are missing", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "devbuild-missing-patches-"));
  try {
    await fsp.mkdir(path.join(tmp, "patches"), { recursive: true });
    await fsp.mkdir(path.join(tmp, "patches", "node"), { recursive: true });
    await fsp.mkdir(path.join(tmp, "patches", "python"), { recursive: true });

    const missing = await missingOptionalPatchDirsForFreshIsolation({
      root: tmp,
      subcmd: "build",
      restArgs: ["//..."],
    });

    assert.deepEqual(missing, ["cpp", "go", "rust"]);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("dev-build keeps shared isolation for non-recursive builds", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "devbuild-present-patches-"));
  try {
    await fsp.mkdir(path.join(tmp, "patches"), { recursive: true });
    const missing = await missingOptionalPatchDirsForFreshIsolation({
      root: tmp,
      subcmd: "build",
      restArgs: ["//projects/apps/pleomino:unit"],
    });
    assert.deepEqual(missing, []);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});
