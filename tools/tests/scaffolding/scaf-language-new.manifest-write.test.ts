#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("scaf language new writes manifest and generates planner by default", async () => {
  await runInTemp("scaf-lang-new", async (tmp, $) => {
    const id = "toy";
    // Create minimal language kit template source to avoid depending on repo templates
    const kitDir = path.join(tmp, "tools/scaffolding/templates/language/kit/{{ lang_id }}");
    await fs.mkdirp(kitDir);
    await fs.outputFile(
      path.join(tmp, "tools/scaffolding/templates/language/kit/meta.json"),
      JSON.stringify({
        language: "language",
        template: "kit",
        description: "lang kit",
        help: { usage: "x" },
      }),
      "utf8",
    );
    await fs.outputFile(
      path.join(tmp, "tools/scaffolding/templates/language/kit/copier.yaml"),
      "lang_id: toy\n",
      "utf8",
    );
    await fs.outputFile(
      path.join(tmp, "tools/scaffolding/templates/language/kit/README.md.jinja"),
      "# Kit\n",
      "utf8",
    );
    await fs.outputFile(
      path.join(
        tmp,
        "tools/scaffolding/templates/language/kit/tools/nix/planner/{{ lang_id }}.nix.jinja",
      ),
      "{ lib }: ctx: { isTarget = n: false; kindOf = n: null; modulesFileFor = name: ctx.modulesTomlFor name; mkApp = name: ctx.T.goApp { inherit name; modulesToml = ctx.modulesTomlFor name; repoRoot = ctx.repoRoot; subdir = (ctx.pkgPathOf name); }; mkLib = name: ctx.T.goLib { inherit name; modulesToml = ctx.modulesTomlFor name; repoRoot = ctx.repoRoot; subdir = (ctx.pkgPathOf name); }; }\n",
      "utf8",
    );
    // Run command
    await $`node tools/scaffolding/scaf.ts language new ${id}`;
    const manifest = path.join(tmp, "tools/nix/langs.json");
    const planner = path.join(tmp, `tools/nix/planner/${id}.nix`);
    assert.ok(await fs.pathExists(manifest), "manifest should be written");
    assert.ok(await fs.pathExists(planner), "planner should be generated or present");
    const doc = JSON.parse(await fs.readFile(manifest, "utf8"));
    const ids = (Array.isArray(doc.languages) ? doc.languages : []).map((e: any) => e.id);
    assert.ok(ids.includes(id), "language id present in manifest.languages");
  });
});
