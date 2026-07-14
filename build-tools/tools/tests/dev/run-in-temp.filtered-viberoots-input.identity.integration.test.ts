#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInScratchTemp } from "../lib/test-helpers";

test("independent scratch repos reuse one immutable filtered viberoots input", async () => {
  const storePaths: string[] = [];
  for (const suffix of ["a", "b"]) {
    await runInScratchTemp(`filtered-viberoots-identity-${suffix}`, async (tmp) => {
      const storePath = String(process.env.VIBEROOTS_FLAKE_INPUT_ROOT || "");
      assert.match(storePath, /^\/nix\/store\/[a-z0-9]{32}-source$/);
      assert.equal(await fsp.realpath(storePath), storePath);
      assert.equal(
        await fsp
          .stat(path.join(tmp, ".viberoots", "workspace", "viberoots-flake-input"))
          .then(() => true)
          .catch(() => false),
        false,
      );
      storePaths.push(storePath);
    });
  }
  assert.equal(storePaths[0], storePaths[1]);
});
