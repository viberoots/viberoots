#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { maybePrintImpureMaterializedBins } from "../../dev/dev-build/materialize-impure";
import { DEFAULT_GRAPH_PATH } from "../../lib/workspace-state-paths";
import { runInTemp } from "../lib/test-helpers";

test("materialize impure fails fast when nix build exceeds timeout", async () => {
  await runInTemp("materialize-impure-timeout", async (tmp) => {
    const graphPath = path.join(tmp, DEFAULT_GRAPH_PATH);
    await fsp.mkdir(path.dirname(graphPath), { recursive: true });
    await fsp.writeFile(
      graphPath,
      JSON.stringify(
        [
          {
            name: "root//projects/apps/web:web",
            labels: ["kind:app"],
          },
        ],
        null,
        2,
      ) + "\n",
      "utf8",
    );

    const prevTimeout = process.env.VBR_MATERIALIZE_TIMEOUT_SEC;
    const prevRunnableTimeout = process.env.VBR_RUNNABLE_BUILD_TIMEOUT_SEC;
    process.env.VBR_MATERIALIZE_TIMEOUT_SEC = "1";
    let invocation: { env?: Record<string, string>; internal?: Record<string, string> } | undefined;
    try {
      await assert.rejects(
        async () =>
          await maybePrintImpureMaterializedBins({
            root: tmp,
            impure: true,
            subcmd: "build",
            restArgs: ["//projects/apps/web:web"],
            runNixBuild: async (opts) => {
              invocation = opts;
              assert.equal(process.env.VBR_RUNNABLE_BUILD_TIMEOUT_SEC, "1");
              throw new Error(
                "[run-runnable] impure materialize selected target //projects/apps/web:web timed out after 1s",
              );
            },
          }),
        /timed out after 1s/,
      );
    } finally {
      if (prevTimeout == null) delete process.env.VBR_MATERIALIZE_TIMEOUT_SEC;
      else process.env.VBR_MATERIALIZE_TIMEOUT_SEC = prevTimeout;
    }
    assert.equal(process.env.VBR_RUNNABLE_BUILD_TIMEOUT_SEC, prevRunnableTimeout);
    const observed = invocation as NonNullable<typeof invocation>;
    assert.ok(observed, "expected the selected target to invoke the Nix build boundary");
    for (const name of ["BUCK_GRAPH_JSON", "BUCK_TARGET", "BUCK_TEST_SRC", "NIX_BIN"]) {
      assert.equal(observed.env?.[name], undefined, `${name} must not use the base env channel`);
    }
    assert.deepEqual(observed.internal, {
      BUCK_TEST_SRC: tmp,
      BUCK_GRAPH_JSON: graphPath,
      BUCK_TARGET: "//projects/apps/web:web",
    });
  });
});
