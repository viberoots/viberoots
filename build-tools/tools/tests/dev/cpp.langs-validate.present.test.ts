#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("cpp present: validator passes and diagnose enables cpp", async () => {
  await runInTemp("cpp-present", async (tmp, $) => {
    // Write manifest with cpp entry
    const manifest = {
      enabled: ["go", "cpp"],
      languages: [
        {
          id: "go",
          displayName: "Go",
          requiredPaths: ["build-tools/tools/nix/templates/go.nix", "build-tools/go/defs.bzl"],
          kinds: ["cli", "lib"],
          templatesDir: "build-tools/tools/scaffolding/templates/go",
        },
        {
          id: "cpp",
          displayName: "C++",
          requiredPaths: ["build-tools/cpp/defs.bzl", "build-tools/tools/nix/templates/cpp.nix"],
          kinds: ["bin", "lib", "test"],
          templatesDir: "build-tools/tools/scaffolding/templates/cpp",
          capabilities: { patching: false },
        },
      ],
    } as any;
    await fs.outputFile(
      path.join(tmp, "build-tools/tools/nix/langs.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );

    // Create requiredPaths for cpp
    await fs.outputFile(path.join(tmp, "build-tools/cpp/defs.bzl"), "# cpp defs\n");
    await fs.outputFile(path.join(tmp, "build-tools/tools/nix/templates/cpp.nix"), "# nix\n");

    // Copy validator/diagnose scripts into temp
    await fs.copy(
      path.join(process.cwd(), "build-tools/tools/dev/langs.schema.json"),
      path.join(tmp, "build-tools/tools/dev/langs.schema.json"),
    );
    await fs.copy(
      path.join(process.cwd(), "build-tools/tools/dev/validate-langs.ts"),
      path.join(tmp, "build-tools/tools/dev/validate-langs.ts"),
    );
    await fs.copy(
      path.join(process.cwd(), "build-tools/tools/dev/langs-diagnose.ts"),
      path.join(tmp, "build-tools/tools/dev/langs-diagnose.ts"),
    );

    // Validate manifest
    const vres = await $({ cwd: tmp })`node build-tools/tools/dev/validate-langs.ts`;
    assert.match(String(vres.stdout), /langs\.json: OK/);

    // Diagnose should enable cpp
    const dres = await $({
      cwd: tmp,
    })`node build-tools/tools/dev/langs-diagnose.ts --json --lang cpp`;
    const obj = JSON.parse(String(dres.stdout || "{}"));
    assert.ok(Array.isArray(obj.enabled));
    assert.ok(obj.enabled.includes("cpp"));
    const disabled = (obj.disabled as any[]).filter((d) => d.id === "cpp");
    assert.equal(disabled.length, 0);
  });
});
