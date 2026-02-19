#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { materializePureGraphIfEnabled } from "../../dev/dev-build/materialize-pure.ts";
import { runInTemp } from "../lib/test-helpers.ts";

test("materialize pure does not run redundant .#buck-graph build", async () => {
  await runInTemp("materialize-pure-skip-buck-graph", async (tmp) => {
    const stubBin = path.join(tmp, ".stub-bin");
    const stubNix = path.join(stubBin, "nix");
    const argsLog = path.join(tmp, ".nix-args.log");
    await fsp.mkdir(stubBin, { recursive: true });
    await fsp.writeFile(
      stubNix,
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        `echo \"$*\" >> ${JSON.stringify(argsLog)}`,
        "echo /nix/store/fake-out",
        "",
      ].join("\n"),
      "utf8",
    );
    await fsp.chmod(stubNix, 0o755);

    const prevPath = process.env.PATH || "";
    process.env.PATH = `${stubBin}:${prevPath}`;
    try {
      await materializePureGraphIfEnabled({
        isCI: false,
        root: tmp,
        materialize: true,
        impure: false,
        restArgs: [],
      });
    } finally {
      process.env.PATH = prevPath;
    }

    const txt = await fsp.readFile(argsLog, "utf8");
    assert.ok(
      txt.includes(".#graph-generator-pure"),
      `expected pure graph generator build in nix args, got: ${txt}`,
    );
    assert.ok(
      !txt.includes(".#buck-graph"),
      `did not expect redundant buck-graph build in nix args, got: ${txt}`,
    );
  });
});
