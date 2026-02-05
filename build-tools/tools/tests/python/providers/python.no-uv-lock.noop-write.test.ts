#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp, exists } from "../../lib/test-helpers";

test("providers: Python sync with no uv.lock writes stable header and no entries", async () => {
  await runInTemp("python-no-uv-noop", async (tmp, $) => {
    // No uv.lock under projects/apps/* or projects/libs/* — narrow to python to exercise writer no-op behavior
    const runner = `#!/usr/bin/env zx-wrapper
import { syncAllProviders } from "./build-tools/tools/buck/providers/index.ts";
await syncAllProviders({ lang: "python" });
`;
    const runnerPath = path.join(tmp, "run-sync.mjs");
    await fsp.writeFile(runnerPath, runner, "utf8");
    await $`node ${runnerPath}`;

    const outFile = path.join(tmp, "third_party", "providers", "TARGETS.python.auto");
    assert.equal(await exists(outFile), true, "expected TARGETS.python.auto to be generated");
    const txt = await fsp.readFile(outFile, "utf8");
    // Header + load line present
    assert.match(txt, /# GENERATED FILE — DO NOT EDIT\./);
    assert.match(
      txt,
      /load\("\/\/third_party\/providers:defs_python\.bzl", "python_importer_deps"\)/,
    );
    // No provider entries since no uv.lock under projects/apps/* or projects/libs/*
    assert.ok(!/python_importer_deps\(name="/.test(txt), "no providers should be listed");
  });
});
