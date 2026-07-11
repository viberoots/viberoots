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

    const stubBin = path.join(tmp, ".stub-bin");
    const stubNix = path.join(stubBin, "nix");
    const argsLog = path.join(tmp, "nix-args.log");
    const fakeOut = path.join(tmp, "fake-out");
    await fsp.mkdir(stubBin, { recursive: true });
    await fsp.mkdir(fakeOut, { recursive: true });
    await fsp.writeFile(
      stubNix,
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        `printf '%s\\n' "$*" > ${JSON.stringify(argsLog)}`,
        `printf '%s\\n' ${JSON.stringify(fakeOut)}`,
        "",
      ].join("\n"),
      "utf8",
    );
    await fsp.chmod(stubNix, 0o755);

    const prevPath = process.env.PATH || "";
    const prevVbrNixBin = process.env.VBR_NIX_BIN;
    process.env.PATH = `${stubBin}:${prevPath}`;
    process.env.VBR_NIX_BIN = stubNix;
    try {
      await maybePrintImpureMaterializedBins({
        root: tmp,
        impure: true,
        subcmd: "build",
        restArgs: ["//projects/apps/web:web"],
      });
    } finally {
      process.env.PATH = prevPath;
      if (typeof prevVbrNixBin === "string") process.env.VBR_NIX_BIN = prevVbrNixBin;
      else delete process.env.VBR_NIX_BIN;
    }

    const args = await fsp.readFile(argsLog, "utf8");
    assert.match(
      args,
      new RegExp(
        `path:${tmp.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/\\.viberoots/workspace#graph-generator-selected`,
      ),
    );
    assert.doesNotMatch(args, / \.#graph-generator-selected(?: |$)/);
  });
});
