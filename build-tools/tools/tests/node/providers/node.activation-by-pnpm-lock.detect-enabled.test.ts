#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { providerAutoTargetsPath } from "../../../lib/workspace-state-paths";
import { exists, runInTemp } from "../../lib/test-helpers";

test("providers: Node activation via pnpm-lock.yaml in sparse clone (no --lang)", async () => {
  await runInTemp("node-pnpm-activation", async (tmp, $) => {
    const importerDir = path.join(tmp, "projects", "apps", "web");
    await fsp.mkdir(path.join(importerDir, "patches", "node"), { recursive: true });
    const lock = `lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies: {}\n`;
    await fsp.writeFile(path.join(importerDir, "pnpm-lock.yaml"), lock, "utf8");
    // Optional importer-local patch file; provider generator includes all importer-local patches
    await fsp.writeFile(
      path.join(importerDir, "patches", "node", "leftpad@1.3.0.patch"),
      "# patch",
      "utf8",
    );

    // Runner: call syncAllProviders() without narrowing so detection must enable Node
    const runner = `#!/usr/bin/env zx-wrapper
import { syncAllProviders } from "./build-tools/tools/buck/providers/index";
await syncAllProviders();
`;
    const runnerPath = path.join(tmp, "run-sync.mjs");
    await fsp.writeFile(runnerPath, runner, "utf8");
    await $`node ${runnerPath}`;

    const outFile = path.join(tmp, providerAutoTargetsPath("node"));
    assert.equal(await exists(outFile), true, "expected TARGETS.node.auto to be generated");
    const txt = await fsp.readFile(outFile, "utf8");
    // Header + load line present
    assert.match(txt, /# GENERATED FILE — DO NOT EDIT\./);
    assert.match(txt, /load\("\/\/third_party\/providers:defs_node\.bzl", "node_importer_deps"\)/);
    // Provider entry present for projects/apps/web importer
    assert.match(txt, /node_importer_deps\(name="/);
    assert.match(txt, /lockfile="projects\/apps\/web\/pnpm-lock\.yaml"/);
  });
});
