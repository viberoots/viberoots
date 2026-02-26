#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { ensureTemplateVariables } from "../../scaffolding/lib/scaffold-utils/template-vars.ts";
import { runInTemp } from "../lib/test-helpers.ts";

test("template vars infers missing importer from lockfilePath during update", async () => {
  await runInTemp("scaf-template-vars-importer", async (tmp) => {
    const targetDir = path.join(tmp, "projects", "apps", "my-app");
    await fsp.mkdir(targetDir, { recursive: true });
    const answersFile = path.join(targetDir, ".copier-answers.yml");
    const templateDir = path.join(
      tmp,
      "build-tools",
      "tools",
      "scaffolding",
      "templates",
      "ts",
      "webapp-static",
    );
    await fsp.writeFile(
      answersFile,
      [
        "name: my-app",
        "language: ts",
        "template: webapp-static",
        `scaf_src_path: ${templateDir}`,
        "lockfilePath: projects/apps/my-app/pnpm-lock.yaml",
        "pkgScope: @apps",
        "includeNodeTests: true",
        "",
      ].join("\n"),
      "utf8",
    );

    await ensureTemplateVariables(targetDir, answersFile);

    const updated = await fsp.readFile(answersFile, "utf8");
    assert.match(updated, /^importer:\s*projects\/apps\/my-app$/m);
  });
});

test("template vars auto-fills importer in interactive mode without prompting", async () => {
  await runInTemp("scaf-template-vars-importer-interactive", async (tmp) => {
    const targetDir = path.join(tmp, "projects", "apps", "my-app");
    await fsp.mkdir(targetDir, { recursive: true });
    const answersFile = path.join(targetDir, ".copier-answers.yml");
    const templateDir = path.join(
      tmp,
      "build-tools",
      "tools",
      "scaffolding",
      "templates",
      "ts",
      "webapp-static",
    );
    await fsp.writeFile(
      answersFile,
      [
        "name: my-app",
        "language: ts",
        "template: webapp-static",
        `scaf_src_path: ${templateDir}`,
        "lockfilePath: projects/apps/my-app/pnpm-lock.yaml",
        "pkgScope: @apps",
        "includeNodeTests: true",
        "",
      ].join("\n"),
      "utf8",
    );

    const stdinDesc = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    try {
      if (stdinDesc?.configurable !== false) {
        Object.defineProperty(process.stdin, "isTTY", {
          configurable: true,
          value: true,
        });
      }
      await ensureTemplateVariables(targetDir, answersFile);
    } finally {
      if (stdinDesc) {
        Object.defineProperty(process.stdin, "isTTY", stdinDesc);
      }
    }

    const updated = await fsp.readFile(answersFile, "utf8");
    assert.match(updated, /^importer:\s*projects\/apps\/my-app$/m);
  });
});

test("template vars writes YAML-safe quoted pkgScope when inferred", async () => {
  await runInTemp("scaf-template-vars-pkgscope", async (tmp) => {
    const targetDir = path.join(tmp, "projects", "apps", "my-app");
    await fsp.mkdir(targetDir, { recursive: true });
    const answersFile = path.join(targetDir, ".copier-answers.yml");
    const templateDir = path.join(
      tmp,
      "build-tools",
      "tools",
      "scaffolding",
      "templates",
      "ts",
      "webapp-static",
    );
    await fsp.writeFile(
      answersFile,
      [
        "name: my-app",
        "language: ts",
        "template: webapp-static",
        `scaf_src_path: ${templateDir}`,
        "importer: projects/apps/my-app",
        "lockfilePath: projects/apps/my-app/pnpm-lock.yaml",
        "includeNodeTests: true",
        "",
      ].join("\n"),
      "utf8",
    );

    await ensureTemplateVariables(targetDir, answersFile);

    const updated = await fsp.readFile(answersFile, "utf8");
    assert.match(updated, /^pkgScope:\s*"@apps"$/m);
  });
});
