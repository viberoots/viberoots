#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { materializePureGraphIfEnabled } from "../../dev/dev-build/materialize-pure";
import { runInTemp } from "../lib/test-helpers";

test("materialize pure fails fast when nix build exceeds timeout", async () => {
  await runInTemp("materialize-pure-timeout", async (tmp) => {
    const prevTimeout = process.env.VBR_MATERIALIZE_TIMEOUT_SEC;
    process.env.VBR_MATERIALIZE_TIMEOUT_SEC = "1";
    try {
      await assert.rejects(
        async () =>
          await materializePureGraphIfEnabled({
            devOverrides: {},
            isCI: false,
            root: tmp,
            materialize: true,
            impure: false,
            restArgs: [],
            runNixBuild: async () => {
              assert.equal(process.env.VBR_RUNNABLE_BUILD_TIMEOUT_SEC, "1");
              throw new Error("[run-runnable] materialize full pure graph timed out after 1s");
            },
          }),
        /timed out after 1s/,
      );
    } finally {
      if (prevTimeout == null) delete process.env.VBR_MATERIALIZE_TIMEOUT_SEC;
      else process.env.VBR_MATERIALIZE_TIMEOUT_SEC = prevTimeout;
    }
  });
});
