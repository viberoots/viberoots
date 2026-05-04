#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { materializePureGraphIfEnabled } from "../../dev/dev-build/materialize-pure";
import { runInTemp } from "../lib/test-helpers";

test("materialize pure fails fast when nix build exceeds timeout", async () => {
  await runInTemp("materialize-pure-timeout", async (tmp) => {
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
    const prevTimeout = process.env.BNX_MATERIALIZE_TIMEOUT_SEC;
    process.env.PATH = `${stubBin}:${prevPath}`;
    process.env.BNX_MATERIALIZE_TIMEOUT_SEC = "1";
    try {
      await assert.rejects(
        async () =>
          await materializePureGraphIfEnabled({
            isCI: false,
            root: tmp,
            materialize: true,
            impure: false,
            restArgs: [],
          }),
        /timed out after 1s/,
      );
    } finally {
      process.env.PATH = prevPath;
      if (prevTimeout == null) delete process.env.BNX_MATERIALIZE_TIMEOUT_SEC;
      else process.env.BNX_MATERIALIZE_TIMEOUT_SEC = prevTimeout;
    }
  });
});
