#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { runInTemp } from "../lib/test-helpers";
import { copyViberootsSourcePath, viberootsSourcePath } from "../lib/test-helpers/source-paths";

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
    await copyViberootsSourcePath(
      "viberoots/build-tools/tools/dev/langs.schema.json",
      path.join(tmp, "viberoots/build-tools/tools/dev/langs.schema.json"),
    );
    await copyViberootsSourcePath(
      "viberoots/build-tools/tools/dev/validate-langs.ts",
      path.join(tmp, "viberoots/build-tools/tools/dev/validate-langs.ts"),
    );
    const tempViberootsRoot = path.join(tmp, "viberoots");
    const tempToolEnv = {
      ...process.env,
      VIBEROOTS_ROOT: tempViberootsRoot,
      VIBEROOTS_SOURCE_ROOT: tempViberootsRoot,
      NODE_PATH: [path.join(process.cwd(), "node_modules"), process.env.NODE_PATH || ""]
        .filter(Boolean)
        .join(path.delimiter),
    };
    let code = 0;
    try {
      await $({
        cwd: tmp,
        env: tempToolEnv,
      })`node viberoots/build-tools/tools/dev/validate-langs.ts`;
    } catch (e: any) {
      code = e.exitCode || 1;
      const out = String(e.stdout || "") + String(e.stderr || "");
      assert.match(out, /validation failed|Invalid JSON/);
    }
    assert.notEqual(code, 0, "validator should exit non-zero on invalid manifest");
  });
});
