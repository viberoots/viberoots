#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { runInTemp } from "../../lib/test-helpers";
import { providerNameForImporter } from "../../../lib/providers";

test("node providers carry lang:node label", async () => {
  await runInTemp("node-provider-lang-label", async (tmp, $) => {
    await $`git init`;
    // Minimal PNPM lockfile under an importer
    const lf = path.join(tmp, "apps/demo/pnpm-lock.yaml");
    await fsp.mkdir(path.dirname(lf), { recursive: true });
    await fsp.writeFile(
      lf,
      `lockfileVersion: "9.0"\nimporters:\n  apps/demo:\n    dependencies: {}\npackages: {}`,
      "utf8",
    );
    // Generate Node providers
    await $({ cwd: tmp })`node tools/buck/sync-providers.ts --lang node --no-glue`;
    const provider = providerNameForImporter("apps/demo/pnpm-lock.yaml", "apps/demo");
    // Query labels of the provider target
    const cq = await $({
      cwd: tmp,
      stdio: "pipe",
    })`buck2 cquery --target-platforms prelude//platforms:default //third_party/providers:${provider} --json --output-attribute labels`;
    const parsed = JSON.parse(String(cq.stdout || ""));
    let labs: string[] = [];
    if (Array.isArray(parsed)) {
      labs = (parsed[0]?.labels || []) as string[];
    } else if (parsed && typeof parsed === "object") {
      const vals = Object.values(parsed) as Array<{ labels?: string[] }>;
      labs = (vals[0]?.labels || []) as string[];
    }
    assert.ok(labs.includes("lang:node"), "expected provider to have lang:node label");
  });
});
