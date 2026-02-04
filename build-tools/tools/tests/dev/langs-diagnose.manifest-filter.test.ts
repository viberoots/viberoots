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
          requiredPaths: ["go/defs.bzl"],
          kinds: ["cli", "lib"],
          templatesDir: "build-tools/tools/scaffolding/templates/go",
        },
        {
          id: "toy",
          displayName: "Toy",
          requiredPaths: ["build-tools/tools/nix/planner/toy.nix"],
          kinds: ["lib"],
          templatesDir: "build-tools/tools/scaffolding/templates/toy",
        },
      ],
    };
    await fs.outputFile(
      path.join(tmp, "build-tools/tools/nix/langs.json"),
      JSON.stringify(manifest, null, 2) + "\n",
      "utf8",
    );

    const p = path.join(tmp, "build-tools/tools/dev/langs-diagnose.ts");
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
