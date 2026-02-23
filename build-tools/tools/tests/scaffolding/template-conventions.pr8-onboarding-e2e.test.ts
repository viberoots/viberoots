#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("PR-8 e2e: canonical path onboarding wires conventions without template_keys", async () => {
  await runInTemp("template-conventions-pr8-onboarding", async (tmp, _$) => {
    const manifestPath = path.join(
      tmp,
      "build-tools",
      "tools",
      "scaffolding",
      "template-manifest.json",
    );
    const manifestRaw = await fsp.readFile(manifestPath, "utf8");
    const manifest = JSON.parse(manifestRaw) as {
      templates: Array<Record<string, string>>;
    };
    manifest.templates.push({
      language: "ts",
      template: "pr8-synthetic",
      templateRoot: "build-tools/tools/scaffolding/templates/ts/pr8-synthetic",
      resolverDestination: "projects/apps/{name}",
    });
    await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

    const templateRoot = path.join(
      tmp,
      "build-tools",
      "tools",
      "scaffolding",
      "templates",
      "ts",
      "pr8-synthetic",
    );
    await fsp.mkdir(templateRoot, { recursive: true });
    await fsp.writeFile(path.join(templateRoot, "copier.yaml"), 'language: "ts"\n', "utf8");
    await fsp.writeFile(
      path.join(templateRoot, "meta.json"),
      JSON.stringify(
        {
          language: "ts",
          template: "pr8-synthetic",
          description: "PR-8 synthetic template",
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );

    const conventionsPath = path.join(
      tmp,
      "build-tools",
      "tools",
      "tests",
      "template_conventions.bzl",
    );
    const conventionsRaw = await fsp.readFile(conventionsPath, "utf8");
    assert.equal(
      conventionsRaw.includes("template_keys"),
      false,
      "template conventions should use template_roots path conventions only",
    );
    const existingEntry =
      '"build-tools/tools/tests/scaffolding/smoke.lib-readme.test.ts": {\n' +
      '        "template_roots": ["build-tools/tools/scaffolding/templates/go/lib"],\n' +
      '        "classification": "template:smoke",\n' +
      "    },";
    const rewrittenEntry =
      '"build-tools/tools/tests/scaffolding/smoke.lib-readme.test.ts": {\n' +
      '        "template_roots": ["build-tools/tools/scaffolding/templates/ts/pr8-synthetic"],\n' +
      '        "classification": "template:smoke",\n' +
      "    },";
    const updatedConventions = conventionsRaw.replace(existingEntry, rewrittenEntry);
    await fsp.writeFile(conventionsPath, updatedConventions, "utf8");

    const $ = _$({ stdio: "pipe" });
    await $`node build-tools/tools/scaffolding/gen-template-manifest-artifacts.ts`;
    const resolverRaw = await fsp.readFile(
      path.join(tmp, "build-tools", "tools", "scaffolding", "resolver.json"),
      "utf8",
    );
    const resolver = JSON.parse(resolverRaw) as Record<string, Record<string, string>>;
    assert.equal(resolver.ts?.["pr8-synthetic"], "projects/apps/{name}");

    const refreshedConventions = await fsp.readFile(conventionsPath, "utf8");
    assert.equal(refreshedConventions.includes("template_keys"), false);
    assert.equal(refreshedConventions.includes("templates/ts/pr8-synthetic"), true);

    await $`node build-tools/tools/tests/scaffolding/template-taxonomy.pr4-parity-contract.test.ts`;
  });
});
