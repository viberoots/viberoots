#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { copyViberootsSourcePath } from "../lib/test-helpers/source-paths";
import { viberootsTool } from "./lib/viberoots-tools";

test("scaf language new writes manifest and generates planner by default", async () => {
  await runInTemp("scaf-lang-new", async (tmp, $) => {
    const id = "toy";
    // Create minimal language kit template source to avoid depending on repo templates
    const kitDir = path.join(
      tmp,
      "viberoots/build-tools/tools/scaffolding/templates/language/kit/{{ lang_id }}",
    );
    await fs.mkdirp(kitDir);
    await fs.outputFile(
      path.join(tmp, "viberoots/build-tools/tools/scaffolding/templates/language/kit/meta.json"),
      JSON.stringify({
        language: "language",
        template: "kit",
        description: "lang kit",
        help: { usage: "x" },
      }),
      "utf8",
    );
    for (const rel of [
      "viberoots/build-tools/tools/dev/langs.schema.json",
      "viberoots/build-tools/tools/dev/validate-langs.ts",
      "viberoots/build-tools/tools/lib/artifact-reproducibility-matrix.ts",
    ]) {
      await copyViberootsSourcePath(rel, path.join(tmp, rel));
    }
    await fs.outputFile(
      path.join(tmp, "viberoots/build-tools/tools/scaffolding/templates/language/kit/copier.yaml"),
      "lang_id: toy\n",
      "utf8",
    );
    await fs.outputFile(
      path.join(
        tmp,
        "viberoots/build-tools/tools/scaffolding/templates/language/kit/README.md.jinja",
      ),
      "# Kit\n",
      "utf8",
    );
    await fs.outputFile(
      path.join(
        tmp,
        "viberoots/build-tools/tools/scaffolding/templates/language/kit/viberoots/build-tools/tools/nix/planner/{{ lang_id }}.nix.jinja",
      ),
      "{ lib }: ctx: { isTarget = n: false; kindOf = n: null; modulesFileFor = name: ctx.modulesTomlFor name; mkApp = name: ctx.T.goApp { inherit name; modulesToml = ctx.modulesTomlFor name; repoRoot = ctx.repoRoot; subdir = (ctx.pkgPathOf name); }; mkLib = name: ctx.T.goLib { inherit name; modulesToml = ctx.modulesTomlFor name; repoRoot = ctx.repoRoot; subdir = (ctx.pkgPathOf name); }; }\n",
      "utf8",
    );
    // Run command
    await $({
      env: {
        ...process.env,
        VIBEROOTS_ROOT: path.join(tmp, "viberoots"),
        VIBEROOTS_SOURCE_ROOT: path.join(tmp, "viberoots"),
        WORKSPACE_ROOT: tmp,
        BUCK_TEST_SRC: tmp,
      },
    })`node ${viberootsTool("viberoots/build-tools/tools/scaffolding/scaf.ts")} language new ${id}`;
    const manifest = path.join(tmp, "viberoots/build-tools/tools/nix/langs.json");
    const planner = path.join(tmp, `viberoots/build-tools/tools/nix/planner/${id}.nix`);
    assert.ok(await fs.pathExists(manifest), "manifest should be written");
    assert.ok(await fs.pathExists(planner), "planner should be generated or present");
    const doc = JSON.parse(await fs.readFile(manifest, "utf8"));
    const languages = Array.isArray(doc.languages) ? doc.languages : [];
    const ids = languages.map((e: any) => e.id);
    assert.ok(ids.includes(id), "language id present in manifest.languages");
    assert.ok(!doc.enabled.includes(id), "new language remains disabled until graduation");
    assert.equal(languages.find((entry: any) => entry.id === id).hermetic.status, "scaffold");
    assert.deepEqual(
      languages.find((entry: any) => entry.id === id).hermetic.reproducibilityMatrixIds,
      [],
    );
  });
});
