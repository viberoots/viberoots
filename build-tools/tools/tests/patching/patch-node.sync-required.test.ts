#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { DEFAULT_GRAPH_PATH } from "../../lib/workspace-state-paths";
import { runInTemp } from "../lib/test-helpers";

test("patch-node sync-required enforces required transitive patches and can write placeholders", async () => {
  await runInTemp("patch-node-sync-required", async (tmp, $) => {
    const importer = path.join(tmp, "projects", "apps", "web");
    const lib = path.join(tmp, "projects", "libs", "foo");
    await fsp.mkdir(path.join(importer, "patches", "node"), { recursive: true });
    await fsp.mkdir(lib, { recursive: true });
    await fsp.writeFile(path.join(importer, "pnpm-lock.yaml"), "lockfileVersion: 9\n", "utf8");

    const importerTwo = path.join(tmp, "projects", "apps", "api");
    await fsp.mkdir(path.join(importerTwo, "patches", "node"), { recursive: true });
    await fsp.writeFile(path.join(importerTwo, "pnpm-lock.yaml"), "lockfileVersion: 9\n", "utf8");

    const graphPath = path.join(tmp, DEFAULT_GRAPH_PATH);
    await fsp.mkdir(path.dirname(graphPath), { recursive: true });
    await fsp.writeFile(
      graphPath,
      JSON.stringify(
        {
          nodes: [
            {
              name: "//projects/apps/web:web",
              deps: ["//projects/libs/foo:foo"],
              labels: ["lang:node"],
            },
            {
              name: "//projects/libs/foo:foo",
              deps: [],
              labels: ["node_patch_required:lodash@4.17.21", "node_patch_optional:debug@4.3.4"],
            },
            {
              name: "//projects/apps/api:api",
              deps: [],
              labels: ["node_patch_required:chalk@5.3.0"],
            },
          ],
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(importer, "patches", "node", "debug@4.3.4.patch"),
      "# optional present\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(importerTwo, "patches", "node", "chalk@5.3.0.patch"),
      "# present\n",
      "utf8",
    );

    const cli = path.join(tmp, "build-tools", "tools", "bin", "patch-pkg");
    await $`chmod +x ${cli}`;

    const failRun = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
      env: {
        ...process.env,
        WORKSPACE_ROOT: tmp,
      },
    })`${cli} sync-required node --importer projects/apps/web`;
    if (failRun.exitCode === 0) {
      throw new Error("expected sync-required to fail when required patch is missing");
    }
    const failOut = String(failRun.stdout || "") + String(failRun.stderr || "");
    if (!failOut.includes("patch-pkg sync-required node --importer projects/apps/web")) {
      throw new Error("expected importer-specific remediation command");
    }
    if (!failOut.includes("checklist for projects/apps/web")) {
      throw new Error("expected checklist output for importer");
    }
    if (failOut.includes("projects/apps/api") && failOut.includes("missing required")) {
      throw new Error("unrelated importer should remain unaffected");
    }

    const fixRun = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
      env: {
        ...process.env,
        WORKSPACE_ROOT: tmp,
      },
    })`${cli} sync-required node --importer projects/apps/web --write-placeholders`;
    if (fixRun.exitCode !== 0) {
      throw new Error("expected sync-required placeholder mode to succeed");
    }
    await fsp.access(path.join(importer, "patches", "node", "lodash@4.17.21.patch"));
    await fsp.rm(path.join(importer, "patches", "node", "debug@4.3.4.patch"), { force: true });

    const optionalWarnRun = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
      env: {
        ...process.env,
        WORKSPACE_ROOT: tmp,
      },
    })`${cli} sync-required node --importer projects/apps/web`;
    if (optionalWarnRun.exitCode !== 0) {
      throw new Error("expected sync-required to pass when only optional patches are missing");
    }
    const optionalOut = String(optionalWarnRun.stdout || "") + String(optionalWarnRun.stderr || "");
    if (!optionalOut.includes("WARN: missing optional transitive Node patches")) {
      throw new Error("expected optional warning behavior");
    }
  });
});
