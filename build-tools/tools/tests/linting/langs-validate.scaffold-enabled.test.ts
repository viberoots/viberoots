#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import fs from "fs-extra";
import { runInTemp } from "../lib/test-helpers";
import { copyViberootsSourcePath } from "../lib/test-helpers/source-paths";

test("langs.json rejects enabling a scaffold-only language", async () => {
  await runInTemp("langs-validate-scaffold-enabled", async (tmp, $) => {
    const source = path.join(tmp, "viberoots");
    await fs.outputJson(path.join(source, "build-tools/tools/nix/langs.json"), {
      enabled: ["toy"],
      languages: [
        {
          id: "toy",
          displayName: "Toy",
          requiredPaths: [],
          kinds: ["lib"],
          templatesDir: "viberoots/build-tools/tools/scaffolding/templates/toy",
          hermetic: {
            status: "scaffold",
            sourceRoles: false,
            dependencyReconciliation: false,
            immutableBundleInputs: false,
            storeQualifiedToolchain: false,
            selectorTransport: false,
            sandboxNetwork: false,
            remoteExecution: false,
            publicationAdmission: false,
            reproducibilityMatrixIds: [],
          },
        },
      ],
    });
    for (const rel of [
      "viberoots/build-tools/tools/dev/langs.schema.json",
      "viberoots/build-tools/tools/dev/validate-langs.ts",
      "viberoots/build-tools/tools/lib/artifact-reproducibility-matrix.ts",
    ]) {
      await copyViberootsSourcePath(rel, path.join(tmp, rel));
    }
    const result = await $({
      cwd: tmp,
      env: {
        ...process.env,
        VIBEROOTS_ROOT: source,
        VIBEROOTS_SOURCE_ROOT: source,
      },
      stdio: "pipe",
    })`node viberoots/build-tools/tools/dev/validate-langs.ts`.nothrow();
    assert.notEqual(result.exitCode, 0);
    assert.match(String(result.stderr), /enabled language toy is not graduated/);
  });
});

test("langs.json rejects an unknown reproducibility matrix ID", async () => {
  await runInTemp("langs-validate-unknown-matrix", async (tmp, $) => {
    const source = path.join(tmp, "viberoots");
    await fs.outputJson(path.join(source, "build-tools/tools/nix/langs.json"), {
      enabled: ["toy"],
      languages: [
        {
          id: "toy",
          displayName: "Toy",
          requiredPaths: [],
          kinds: ["lib"],
          templatesDir: "viberoots/build-tools/tools/scaffolding/templates/toy",
          hermetic: {
            status: "graduated",
            sourceRoles: true,
            dependencyReconciliation: true,
            immutableBundleInputs: true,
            storeQualifiedToolchain: true,
            selectorTransport: true,
            sandboxNetwork: true,
            remoteExecution: true,
            publicationAdmission: true,
            reproducibilityMatrixIds: ["made-up"],
          },
        },
      ],
    });
    for (const rel of [
      "viberoots/build-tools/tools/dev/langs.schema.json",
      "viberoots/build-tools/tools/dev/validate-langs.ts",
      "viberoots/build-tools/tools/lib/artifact-reproducibility-matrix.ts",
    ]) {
      await copyViberootsSourcePath(rel, path.join(tmp, rel));
    }
    const result = await $({
      cwd: tmp,
      env: { ...process.env, VIBEROOTS_SOURCE_ROOT: source },
      stdio: "pipe",
    })`node viberoots/build-tools/tools/dev/validate-langs.ts`.nothrow();
    assert.notEqual(result.exitCode, 0);
    assert.match(String(result.stderr), /unknown reproducibilityMatrixId made-up/);
  });
});

test("langs.json rejects a matrix case whose graph labels do not prove the language", async () => {
  await runInTemp("langs-validate-unproven-language", async (tmp, $) => {
    const source = path.join(tmp, "viberoots");
    const required = "viberoots/build-tools/toy/defs.bzl";
    await fs.outputFile(path.join(tmp, required), "# proof\n");
    await fs.outputJson(path.join(source, "build-tools/tools/nix/langs.json"), {
      enabled: ["toy"],
      languages: [
        {
          id: "toy",
          displayName: "Toy",
          requiredPaths: [required],
          kinds: ["lib"],
          templatesDir: "viberoots/build-tools/tools/scaffolding/templates/toy",
          hermetic: {
            status: "graduated",
            sourceRoles: true,
            dependencyReconciliation: true,
            immutableBundleInputs: true,
            storeQualifiedToolchain: true,
            selectorTransport: true,
            sandboxNetwork: true,
            remoteExecution: true,
            publicationAdmission: true,
            reproducibilityMatrixIds: ["go-lib"],
          },
        },
      ],
    });
    for (const rel of [
      "viberoots/build-tools/tools/dev/langs.schema.json",
      "viberoots/build-tools/tools/dev/validate-langs.ts",
      "viberoots/build-tools/tools/lib/artifact-reproducibility-matrix.ts",
    ]) {
      await copyViberootsSourcePath(rel, path.join(tmp, rel));
    }
    const result = await $({
      cwd: tmp,
      env: { ...process.env, VIBEROOTS_SOURCE_ROOT: source },
      stdio: "pipe",
    })`node viberoots/build-tools/tools/dev/validate-langs.ts`.nothrow();
    assert.notEqual(result.exitCode, 0);
    assert.match(String(result.stderr), /does not cover language toy/);
  });
});
