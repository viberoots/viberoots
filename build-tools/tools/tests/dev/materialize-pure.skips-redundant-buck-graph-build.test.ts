#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { materializePureGraphIfEnabled } from "../../dev/dev-build/materialize-pure";
import { runInTemp } from "../lib/test-helpers";

test("materialize pure does not run redundant .#buck-graph build", async () => {
  await runInTemp("materialize-pure-skip-buck-graph", async (tmp) => {
    await materializePureGraphIfEnabled({
      devOverrides: {},
      isCI: false,
      root: tmp,
      materialize: true,
      impure: false,
      restArgs: [],
    });

    const current = path.join(
      tmp,
      ".viberoots",
      "workspace",
      "buck",
      "tmp",
      "runnable-manifest-current",
    );
    assert.match(await fsp.realpath(current), /^\/nix\/store\//u);

    const source = await fsp.readFile(
      new URL("../../dev/dev-build/materialize-pure.ts", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(source, /\.#buck-graph/u);
  });
});
