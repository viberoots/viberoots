#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("providers: buildHandlers(--lang python) yields only Python", async () => {
  await runInTemp("registry-narrow-python", async (tmp, $) => {
    // Provide both lockfiles; narrowing must still return only Python
    const web = path.join(tmp, "apps", "web");
    const api = path.join(tmp, "libs", "api");
    await fsp.mkdir(path.join(web, "patches", "node"), { recursive: true });
    await fsp.mkdir(path.join(api, "patches", "python"), { recursive: true });
    await fsp.writeFile(
      path.join(web, "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies: {}\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(api, "uv.lock"),
      '# uv.lock (minimal)\n[[package]]\nname = "attrs"\nversion = "23.2.0"\n',
      "utf8",
    );

    const runner = `#!/usr/bin/env zx-wrapper
import { buildHandlers } from "./build-tools/tools/buck/providers/index";
const hs = await buildHandlers("python");
console.log(JSON.stringify(hs.map(h => h.lang)));
`;
    const runnerPath = path.join(tmp, "run-registry-narrow.mjs");
    await fsp.writeFile(runnerPath, runner, "utf8");
    const { stdout } = await $`node ${runnerPath}`;
    const langs = JSON.parse(String(stdout || "[]").trim()) as string[];
    assert.deepEqual(langs, ["python"], "expected only Python handler when narrowed");
  });
});
