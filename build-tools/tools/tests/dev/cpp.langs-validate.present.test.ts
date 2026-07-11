#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { copyViberootsSourcePath, viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("cpp present: validator passes and diagnose enables cpp", async () => {
  await runInTemp("cpp-present", async (tmp, $) => {
    // Write manifest with cpp entry
    const manifest = {
      enabled: ["go", "cpp"],
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
        {
          id: "cpp",
          displayName: "C++",
          requiredPaths: [
            "viberoots/build-tools/cpp/defs.bzl",
            "viberoots/build-tools/tools/nix/templates/cpp.nix",
          ],
          kinds: ["bin", "lib", "test"],
          templatesDir: "viberoots/build-tools/tools/scaffolding/templates/cpp",
          capabilities: { patching: false },
        },
      ],
    } as any;
    await fs.outputFile(
      path.join(tmp, "viberoots/build-tools/tools/nix/langs.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );

    // Create requiredPaths for cpp
    await fs.outputFile(path.join(tmp, "viberoots/build-tools/cpp/defs.bzl"), "# cpp defs\n");
    await fs.outputFile(
      path.join(tmp, "viberoots/build-tools/tools/nix/templates/cpp.nix"),
      "# nix\n",
    );

    // Copy validator/diagnose scripts into temp
    await copyViberootsSourcePath(
      "viberoots/build-tools/tools/dev/langs.schema.json",
      path.join(tmp, "viberoots/build-tools/tools/dev/langs.schema.json"),
    );
    await copyViberootsSourcePath(
      "viberoots/build-tools/tools/dev/validate-langs.ts",
      path.join(tmp, "viberoots/build-tools/tools/dev/validate-langs.ts"),
    );
    await copyViberootsSourcePath(
      "viberoots/build-tools/tools/dev/langs-diagnose.ts",
      path.join(tmp, "viberoots/build-tools/tools/dev/langs-diagnose.ts"),
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

    // Validate manifest
    const vres = await $({
      cwd: tmp,
      env: tempToolEnv,
    })`node viberoots/build-tools/tools/dev/validate-langs.ts`;
    assert.match(String(vres.stdout), /langs\.json: OK/);

    // Diagnose should enable cpp
    const dres = await $({
      cwd: tmp,
      env: tempToolEnv,
    })`node viberoots/build-tools/tools/dev/langs-diagnose.ts --json --lang cpp`;
    const obj = JSON.parse(String(dres.stdout || "{}"));
    assert.ok(Array.isArray(obj.enabled));
    assert.ok(obj.enabled.includes("cpp"));
    const disabled = (obj.disabled as any[]).filter((d) => d.id === "cpp");
    assert.equal(disabled.length, 0);
  });
});
