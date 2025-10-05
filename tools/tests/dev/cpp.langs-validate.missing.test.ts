#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("cpp missing: diagnose reports disabled with missing paths", async () => {
  await runInTemp("cpp-missing", async (tmp, $) => {
    const manifest = {
      enabled: ["go", "cpp"],
      languages: [
        {
          id: "cpp",
          displayName: "C++",
          requiredPaths: ["cpp/defs.bzl", "tools/nix/templates/cpp.nix"],
          kinds: ["bin", "lib", "test"],
          templatesDir: "tools/scaffolding/templates/cpp",
          capabilities: { patching: false },
        },
      ],
    } as any;
    await fs.outputFile(
      path.join(tmp, "tools/nix/langs.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );

    // Copy diagnose script only; do not create required cpp files
    await fs.copy(
      path.join(process.cwd(), "tools/dev/langs-diagnose.ts"),
      path.join(tmp, "tools/dev/langs-diagnose.ts"),
    );

    const dres = await $({ cwd: tmp })`node tools/dev/langs-diagnose.ts --json --lang cpp`;
    const obj = JSON.parse(String(dres.stdout || "{}"));
    assert.ok(Array.isArray(obj.enabled));
    // cpp should not be enabled
    assert.ok(!obj.enabled.includes("cpp"));
    const cpp = (obj.disabled as any[]).find((d) => d.id === "cpp");
    assert.ok(cpp, "cpp should appear disabled");
    const miss = (cpp.missingPaths || []) as string[];
    // Both required paths should be reported missing
    assert.ok(miss.includes("cpp/defs.bzl"));
    assert.ok(miss.includes("tools/nix/templates/cpp.nix"));
  });
});
