#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { maybePrintImpureMaterializedBins } from "../../dev/dev-build/materialize-impure";
import { DEFAULT_GRAPH_PATH } from "../../lib/workspace-state-paths";
import { runInTemp } from "../lib/test-helpers";

test("materialize impure skips full graph summary for non-specific target sets", async () => {
  await runInTemp("materialize-impure-nonspecific-skip", async (tmp) => {
    const stubBin = path.join(tmp, ".stub-bin");
    const stubNix = path.join(stubBin, "nix");
    await fsp.mkdir(stubBin, { recursive: true });
    await fsp.writeFile(
      stubNix,
      ["#!/usr/bin/env bash", "set -euo pipefail", "echo should-not-run >&2", "exit 99", ""].join(
        "\n",
      ),
      "utf8",
    );
    await fsp.chmod(stubNix, 0o755);
    await fsp.mkdir(path.dirname(path.join(tmp, DEFAULT_GRAPH_PATH)), { recursive: true });
    await fsp.writeFile(
      path.join(tmp, DEFAULT_GRAPH_PATH),
      JSON.stringify(
        {
          nodes: [
            { name: "//projects/apps/web:web", labels: ["lang:node", "kind:app"] },
            { name: "//projects/tools/cli:bin", labels: ["kind:bin"] },
            { name: "//projects/libs/core:lib", labels: ["kind:lib"] },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const prevPath = process.env.PATH || "";
    process.env.PATH = `${stubBin}:${prevPath}`;
    const prevLog = console.log;
    const logs: string[] = [];
    console.log = (...args: unknown[]) => logs.push(args.map((a) => String(a)).join(" "));
    try {
      await maybePrintImpureMaterializedBins({
        root: tmp,
        impure: true,
        subcmd: "build",
        restArgs: ["//..."],
      });
      assert.ok(
        logs.some((l) => l.includes("Impure runnable targets (from exported graph labels):")),
      );
      assert.ok(logs.some((l) => l.includes("//projects/apps/web:web [app]")));
      assert.ok(logs.some((l) => l.includes("//projects/tools/cli:bin [bin]")));
      assert.ok(!logs.some((l) => l.includes("//projects/libs/core:lib")));
    } finally {
      console.log = prevLog;
      process.env.PATH = prevPath;
    }
  });
});
