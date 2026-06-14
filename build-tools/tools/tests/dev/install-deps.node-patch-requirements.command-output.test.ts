#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { DEFAULT_GRAPH_PATH } from "../../lib/workspace-state-paths";
import { runInTemp } from "../lib/test-helpers";

test("install node patch warning surfaces importer-specific remediation command", async () => {
  await runInTemp("install-node-patch-warning-command", async (tmp, $) => {
    const importer = path.join(tmp, "projects", "apps", "web");
    await fsp.mkdir(importer, { recursive: true });
    await fsp.writeFile(path.join(importer, "pnpm-lock.yaml"), "lockfileVersion: 9\n", "utf8");
    const graphPath = path.join(tmp, DEFAULT_GRAPH_PATH);
    await fsp.mkdir(path.dirname(graphPath), { recursive: true });
    await fsp.writeFile(
      graphPath,
      JSON.stringify(
        {
          nodes: [
            {
              name: "//projects/apps/web:web",
              deps: [],
              labels: ["node_patch_required:lodash@4.17.21"],
            },
          ],
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    const out = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
      env: { ...process.env, WORKSPACE_ROOT: tmp },
    })`node --input-type=module --experimental-strip-types --import ./build-tools/tools/dev/zx-init.mjs -e "import { warnNodePatchRequirementsInLocal } from './build-tools/tools/lib/node-deps-enforcement'; await warnNodePatchRequirementsInLocal(process.cwd());"`;
    const all = String(out.stdout || "") + String(out.stderr || "");
    if (!all.includes("patch-pkg sync-required node --importer projects/apps/web")) {
      throw new Error("expected importer-specific remediation command in warning output");
    }
  });
});
