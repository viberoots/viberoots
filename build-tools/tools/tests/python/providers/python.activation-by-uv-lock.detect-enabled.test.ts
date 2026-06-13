#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { providerAutoTargetsPath } from "../../../lib/workspace-state-paths";
import { runInTemp, exists } from "../../lib/test-helpers";

test("providers: Python activation via uv.lock in sparse clone (no --lang)", async () => {
  await runInTemp("python-uv-activation", async (tmp, $) => {
    // Synthesize a sparse slice: only projects/libs/api/uv.lock and optional importer-local patches
    const importerDir = path.join(tmp, "projects", "libs", "api");
    await fsp.mkdir(path.join(importerDir, "patches", "python"), { recursive: true });
    // Minimal uv.lock with one package entry (parser tolerates empty as well)
    const uvLock = `# uv.lock (minimal)
[[package]]
name = "attrs"
version = "23.2.0"
`;
    await fsp.writeFile(path.join(importerDir, "uv.lock"), uvLock, "utf8");
    // Optional importer-local patch file (filtered by effective set; presence shouldn't break)
    await fsp.writeFile(
      path.join(importerDir, "patches", "python", "attrs@23.2.0.patch"),
      "# patch",
      "utf8",
    );

    // Runner: call syncAllProviders() without narrowing so detection must enable Python
    const runner = `#!/usr/bin/env zx-wrapper
import { syncAllProviders } from "./build-tools/tools/buck/providers/index";
await syncAllProviders();
`;
    const runnerPath = path.join(tmp, "run-sync.mjs");
    await fsp.writeFile(runnerPath, runner, "utf8");
    await $`node ${runnerPath}`;

    const outFile = path.join(tmp, providerAutoTargetsPath("python"));
    assert.equal(await exists(outFile), true, "expected TARGETS.python.auto to be generated");
    const txt = await fsp.readFile(outFile, "utf8");
    // Header + load line present
    assert.match(txt, /# GENERATED FILE — DO NOT EDIT\./);
    assert.match(
      txt,
      /load\("@root\/\/third_party\/providers:defs_python\.bzl", "python_importer_deps"\)/,
    );
    // Provider entry present for projects/libs/api importer
    assert.match(txt, /python_importer_deps\(name="/);
    assert.match(txt, /lockfile="projects\/libs\/api\/uv\.lock"/);
  });
});
