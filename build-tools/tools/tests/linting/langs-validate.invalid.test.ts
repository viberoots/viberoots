#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { runInTemp } from "../lib/test-helpers";

test("langs.json invalid fails validator with message", async () => {
  await runInTemp("langs-validate-invalid", async (tmp, $) => {
    // Missing required properties in language entry
    const manifest = {
      languages: [
        {
          id: "go",
          displayName: "Go",
        },
      ],
    } as any;
    await fs.outputFile(
      path.join(tmp, "viberoots/build-tools/tools/nix/langs.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    await fs.copy(
      path.join(process.cwd(), "viberoots/build-tools/tools/dev/langs.schema.json"),
      path.join(tmp, "viberoots/build-tools/tools/dev/langs.schema.json"),
    );
    await fs.copy(
      path.join(process.cwd(), "viberoots/build-tools/tools/dev/validate-langs.ts"),
      path.join(tmp, "viberoots/build-tools/tools/dev/validate-langs.ts"),
    );
    let code = 0;
    try {
      await $({
        cwd: tmp,
        env: {
          ...process.env,
          VIBEROOTS_ROOT: path.join(tmp, "viberoots"),
          VIBEROOTS_SOURCE_ROOT: path.join(tmp, "viberoots"),
        },
      })`node viberoots/build-tools/tools/dev/validate-langs.ts`;
    } catch (e: any) {
      code = e.exitCode || 1;
      const out = String(e.stdout || "") + String(e.stderr || "");
      assert.match(out, /validation failed|Invalid JSON/);
    }
    assert.notEqual(code, 0, "validator should exit non-zero on invalid manifest");
  });
});
