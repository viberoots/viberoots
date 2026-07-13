#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { runInTemp } from "../lib/test-helpers";
import { copyViberootsSourcePath, viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("langs.json valid passes validator", async () => {
  await runInTemp("langs-validate-valid", async (tmp, $) => {
    const manifest = {
      enabled: ["go"],
      languages: [
        {
          id: "go",
          displayName: "Go",
          requiredPaths: [
            "viberoots/build-tools/tools/nix/templates/go.nix",
            "viberoots/build-tools/go/defs.bzl",
          ],
          kinds: ["cli", "lib"],
          templatesDir: "viberoots/build-tools/tools/scaffolding/templates/go",
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
    const testNodeModules = String(process.env.ZX_TEST_NODE_MODULES_OUT || "").trim();
    const tempToolEnv = {
      ...process.env,
      NODE_PATH: [
        path.join(process.cwd(), "node_modules"),
        testNodeModules
          ? testNodeModules.endsWith("node_modules")
            ? testNodeModules
            : path.join(testNodeModules, "node_modules")
          : "",
        process.env.NODE_PATH || "",
      ]
        .filter(Boolean)
        .join(path.delimiter),
    };
    const res = await $({
      cwd: tmp,
      env: tempToolEnv,
    })`node viberoots/build-tools/tools/dev/validate-langs.ts`;
    assert.match(String(res.stdout), /langs\.json: OK/);
  });
});
