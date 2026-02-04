#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { runInTemp } from "../lib/test-helpers";

test("langs.json valid passes validator", async () => {
  await runInTemp("langs-validate-valid", async (tmp, $) => {
    const manifest = {
      enabled: ["go"],
      languages: [
        {
          id: "go",
          displayName: "Go",
          requiredPaths: ["build-tools/tools/nix/templates/go.nix", "go/defs.bzl"],
          kinds: ["cli", "lib"],
          templatesDir: "build-tools/tools/scaffolding/templates/go",
        },
      ],
    } as any;
    await fs.outputFile(
      path.join(tmp, "build-tools/tools/nix/langs.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    await fs.copy(
      path.join(process.cwd(), "build-tools/tools/dev/langs.schema.json"),
      path.join(tmp, "build-tools/tools/dev/langs.schema.json"),
    );
    await fs.copy(
      path.join(process.cwd(), "build-tools/tools/dev/validate-langs.ts"),
      path.join(tmp, "build-tools/tools/dev/validate-langs.ts"),
    );
    const res = await $({ cwd: tmp })`node build-tools/tools/dev/validate-langs.ts`;
    assert.match(String(res.stdout), /langs\.json: OK/);
  });
});
