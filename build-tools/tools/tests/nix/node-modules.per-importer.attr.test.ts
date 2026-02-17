#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("nix packages expose per-importer node-modules attr for untracked importer under WORKSPACE_ROOT", async () => {
  await runInTemp("node-modules-per-importer-attr", async (tmp, _$) => {
    const importer = "projects/apps/demo-untracked";
    const attr = "projects-apps-demo-untracked";
    const importerAbs = path.join(tmp, "projects", "apps", "demo-untracked");

    await fsp.mkdir(importerAbs, { recursive: true });
    await fsp.writeFile(
      path.join(importerAbs, "package.json"),
      JSON.stringify(
        {
          name: "demo-untracked",
          private: true,
          version: "0.0.0",
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(importerAbs, "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'\n",
      "utf8",
    );

    const $ = _$({ cwd: tmp, stdio: "pipe" });
    const flakeRef = `path:${tmp}`;
    const cmd = `nix eval --raw "${flakeRef}#node-modules.${attr}.outPath" --accept-flake-config`;
    const out = await $`bash --noprofile --norc -c ${cmd}`;
    const outPath = String(out.stdout || "").trim();

    assert.ok(outPath.length > 0, `expected non-empty outPath for importer ${importer}`);
  });
});
