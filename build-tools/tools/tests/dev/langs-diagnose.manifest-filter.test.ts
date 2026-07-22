#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("langs-diagnose respects --lang filter and reads manifest", async () => {
  await runInTemp("langs-diagnose-filter", async (tmp, $) => {
    // Minimal manifest with go and toy; only go paths exist in baseline
    const manifest = {
      enabled: ["go", "toy"],
      languages: [
        {
          id: "go",
          displayName: "Go",
          requiredPaths: ["viberoots/build-tools/go/defs.bzl"],
          kinds: ["cli", "lib"],
          templatesDir: "viberoots/build-tools/tools/scaffolding/templates/go",
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
        {
          id: "toy",
          displayName: "Toy",
          requiredPaths: ["viberoots/build-tools/tools/nix/planner/toy.nix"],
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
    };
    await fs.outputFile(
      path.join(tmp, "viberoots/build-tools/tools/nix/langs.json"),
      JSON.stringify(manifest, null, 2) + "\n",
      "utf8",
    );

    const p = path.join(tmp, "viberoots/build-tools/tools/dev/langs-diagnose.ts");
    const res = await $`node ${p} --json --lang go`;
    const obj = JSON.parse(String(res.stdout || "{}"));
    assert.ok(Array.isArray(obj.enabled));
    assert.ok(obj.enabled.includes("go"));
    // toy should not appear enabled when filtered to go
    assert.ok(!obj.enabled.includes("toy"));
    assert.ok(Array.isArray(obj.disabled));
    // With --lang go, toy should not appear in disabled set
    const toy = (obj.disabled as any[]).find((d) => d.id === "toy");
    assert.ok(!toy);
  });
});
