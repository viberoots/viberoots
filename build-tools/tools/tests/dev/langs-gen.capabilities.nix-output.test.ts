#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { copyViberootsSourcePath, viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("gen-langs: generates langs.nix from manifest capabilities deterministically", async () => {
  await runInTemp("gen-langs-capabilities", async (tmp, $) => {
    const manifest = {
      languages: [
        {
          id: "node",
          displayName: "Node",
          requiredPaths: ["**/pnpm-lock.yaml"],
          kinds: ["app", "lib", "workspace"],
          templatesDir: "viberoots/build-tools/tools/scaffolding/templates/node",
          capabilities: { patching: true, lockfileLabels: true, testAutoWire: false },
        },
        {
          id: "go",
          displayName: "Go",
          requiredPaths: [
            "viberoots/build-tools/tools/nix/templates/go.nix",
            "viberoots/build-tools/go/defs.bzl",
          ],
          kinds: ["cli", "lib", "test"],
          templatesDir: "viberoots/build-tools/tools/scaffolding/templates/go",
          capabilities: { patching: true, lockfileLabels: false, testAutoWire: true },
        },
        {
          id: "cpp",
          displayName: "C++",
          requiredPaths: [
            "viberoots/build-tools/tools/nix/templates/cpp.nix",
            "viberoots/build-tools/cpp/defs.bzl",
          ],
          kinds: ["bin", "lib", "test"],
          templatesDir: "viberoots/build-tools/tools/scaffolding/templates/cpp",
          capabilities: { patching: false },
        },
        {
          id: "rust",
          displayName: "Rust",
          requiredPaths: ["viberoots/build-tools/tools/nix/planner/rust.nix"],
          kinds: ["bin", "lib"],
          templatesDir: "viberoots/build-tools/tools/scaffolding/templates/rust",
          // no capabilities → empty attr set
        },
      ],
    } as any;
    await fs.outputFile(
      path.join(tmp, "viberoots/build-tools/tools/nix/langs.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );

    // Copy generator script
    await copyViberootsSourcePath(
      "viberoots/build-tools/tools/dev/gen-langs.ts",
      path.join(tmp, "viberoots/build-tools/tools/dev/gen-langs.ts"),
    );

    // Run generator
    await $({ cwd: tmp })`node viberoots/build-tools/tools/dev/gen-langs.ts`;

    // Verify output
    const outPath = path.join(tmp, "viberoots/build-tools/tools/nix/langs.nix");
    const txt = await fs.readFile(outPath, "utf8");
    assert.match(txt, /# build-tools\/tools\/nix\/langs\.nix — GENERATED FILE — DO NOT EDIT\./);
    // Sorted by id: cpp, go, node, rust
    assert.match(
      txt,
      /\{\s*[^]*cpp\s*=\s*\{[^}]*\}[^]*go\s*=\s*\{[^}]*\}[^]*node\s*=\s*\{[^}]*\}[^]*rust\s*=\s*\{[^}]*\}[^]*\}/m,
    );
    // Capabilities encoded as booleans
    assert.match(txt, /go = [\s\S]*patching = true;/);
    assert.match(txt, /go = [\s\S]*lockfileLabels = false;/);
    assert.match(txt, /go = [\s\S]*testAutoWire = true;/);
    assert.match(txt, /node = [\s\S]*lockfileLabels = true;/);
    assert.match(txt, /cpp = [\s\S]*patching = false;/);
  });
});

test("gen-langs: malformed manifest fails without replacing generated authority", async () => {
  await runInTemp("gen-langs-malformed", async (tmp, $) => {
    const manifestPath = path.join(tmp, "viberoots/build-tools/tools/nix/langs.json");
    const outPath = path.join(tmp, "viberoots/build-tools/tools/nix/langs.nix");
    await fs.outputFile(manifestPath, "{ malformed\n");
    await fs.outputFile(outPath, "# preserved generated authority\n");
    await copyViberootsSourcePath(
      "viberoots/build-tools/tools/dev/gen-langs.ts",
      path.join(tmp, "viberoots/build-tools/tools/dev/gen-langs.ts"),
    );

    const result = await $({
      cwd: tmp,
      stdio: "pipe",
    })`node viberoots/build-tools/tools/dev/gen-langs.ts`.nothrow();
    assert.notEqual(result.exitCode, 0);
    assert.equal(await fs.readFile(outPath, "utf8"), "# preserved generated authority\n");
  });
});
