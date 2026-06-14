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

    const stubBin = path.join(tmp, ".stub-bin");
    const stubNix = path.join(stubBin, "nix");
    await fsp.mkdir(stubBin, { recursive: true });
    await fsp.writeFile(
      stubNix,
      ["#!/usr/bin/env bash", "set -euo pipefail", "sleep 5", "echo /nix/store/fake-out", ""].join(
        "\n",
      ),
      "utf8",
    );
    await fsp.chmod(stubNix, 0o755);

    const prevPath = process.env.PATH || "";
    const prevTimeout = process.env.VBR_MATERIALIZE_TIMEOUT_SEC;
    process.env.PATH = `${stubBin}:${prevPath}`;
    process.env.VBR_MATERIALIZE_TIMEOUT_SEC = "1";
    try {
      await assert.rejects(
        async () =>
          await maybePrintImpureMaterializedBins({
            root: tmp,
            impure: true,
            subcmd: "build",
            restArgs: ["//projects/apps/web:web"],
          }),
        /timed out after 1s/,
      );
    } finally {
      process.env.PATH = prevPath;
      if (prevTimeout == null) delete process.env.VBR_MATERIALIZE_TIMEOUT_SEC;
      else process.env.VBR_MATERIALIZE_TIMEOUT_SEC = prevTimeout;
    }
  });
});
