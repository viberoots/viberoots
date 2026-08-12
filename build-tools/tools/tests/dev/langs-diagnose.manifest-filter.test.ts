#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { detectEnabledLanguages } from "../../lib/langs";

async function writeManifestAtomic(file: string, value: unknown): Promise<void> {
  const temp = `${file}.${process.pid}.tmp`;
  await fs.outputFile(temp, JSON.stringify(value, null, 2) + "\n", "utf8");
  await fs.rename(temp, file);
}

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
    await writeManifestAtomic(
      path.join(tmp, "viberoots/build-tools/tools/nix/langs.json"),
      manifest,
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

test("shared language discovery admits enablement-ready experimental contracts", async () => {
  await runInTemp("langs-experimental-enablement", async (tmp) => {
    const source = path.join(tmp, "viberoots");
    const manifestPath = path.join(source, "build-tools/tools/nix/langs.json");
    const requiredPath = "build-tools/rust/defs.bzl";
    const contract = {
      status: "experimental",
      sourceRoles: true,
      dependencyReconciliation: true,
      immutableBundleInputs: true,
      storeQualifiedToolchain: true,
      selectorTransport: true,
      sandboxNetwork: false,
      remoteExecution: true,
      publicationAdmission: false,
      reproducibilityMatrixIds: ["rust-pr5"],
    };
    await writeManifestAtomic(manifestPath, {
      enabled: ["rust"],
      languages: [
        {
          id: "rust",
          displayName: "Rust",
          requiredPaths: [requiredPath],
          kinds: ["bin", "wasi"],
          templatesDir: "build-tools/tools/scaffolding/templates/rust",
          hermetic: contract,
        },
      ],
    });

    assert.deepEqual(
      (await detectEnabledLanguages(source)).map(({ id }) => id),
      ["rust"],
    );

    await writeManifestAtomic(manifestPath, {
      enabled: ["rust"],
      languages: [
        {
          id: "rust",
          requiredPaths: [requiredPath],
          hermetic: { ...contract, selectorTransport: false },
        },
      ],
    });
    assert.deepEqual(await detectEnabledLanguages(source), []);
  });
});
