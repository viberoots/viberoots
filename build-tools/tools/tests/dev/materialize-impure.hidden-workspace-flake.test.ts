#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { maybePrintImpureMaterializedBins } from "../../dev/dev-build/materialize-impure";
import { DEFAULT_GRAPH_PATH } from "../../lib/workspace-state-paths";
import { runInTemp } from "../lib/test-helpers";

test("materialize impure selected targets use hidden workspace flake in extracted workspaces", async () => {
  await runInTemp("materialize-impure-hidden-flake", async (tmp) => {
    const graphPath = path.join(tmp, DEFAULT_GRAPH_PATH);
    await fsp.mkdir(path.dirname(graphPath), { recursive: true });
    await fsp.writeFile(
      graphPath,
      JSON.stringify([{ name: "root//projects/apps/web:web", labels: ["kind:app"] }], null, 2) +
        "\n",
      "utf8",
    );
    await fsp.mkdir(path.join(tmp, ".viberoots", "workspace"), { recursive: true });
    await fsp.writeFile(path.join(tmp, ".viberoots", "workspace", "flake.nix"), "{}\n", "utf8");

    const fakeOut = path.join(tmp, "fake-out");
    await fsp.mkdir(fakeOut, { recursive: true });
    let invocation:
      | {
          env?: Record<string, string>;
          internal?: Record<string, string>;
          args: string[];
        }
      | undefined;
    await maybePrintImpureMaterializedBins({
      root: tmp,
      impure: true,
      subcmd: "build",
      restArgs: ["//projects/apps/web:web"],
      runNixBuild: async (opts) => {
        invocation = opts;
        return `${fakeOut}\n`;
      },
    });

    const observed = invocation as NonNullable<typeof invocation>;
    assert.ok(observed, "expected the selected target to invoke the Nix build boundary");
    const args = observed.args.join(" ");
    assert.match(
      args,
      new RegExp(
        `path:${tmp.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/\\.viberoots/workspace#graph-generator-selected`,
      ),
    );
    assert.doesNotMatch(args, / \.#graph-generator-selected(?: |$)/);
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
