#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("PR-7 smoke: synthetic manifest template is exposed via generated surfaces", async () => {
  await runInTemp("template-manifest-pr7-synthetic", async (tmp, _$) => {
    const syntheticRoot = path.join(
      tmp,
      "build-tools",
      "tools",
      "scaffolding",
      "templates",
      "ts",
      "pr7-synthetic",
    );
    await fsp.mkdir(syntheticRoot, { recursive: true });
    await fsp.writeFile(
      path.join(syntheticRoot, "meta.json"),
      JSON.stringify(
        {
          language: "ts",
          template: "pr7-synthetic",
          resolverDestination: "projects/apps/{name}",
          description: "PR-7 synthetic template",
          help: {
            usage: "scaf new ts pr7-synthetic <name>",
            notes: ["synthetic test template"],
            examples: ["scaf new ts pr7-synthetic demo --yes --dry-run"],
          },
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    await fsp.writeFile(path.join(syntheticRoot, "copier.yaml"), 'language: "ts"\n', "utf8");

    const $ = _$({ stdio: "pipe" });
    await $`node build-tools/tools/scaffolding/gen-template-manifest-artifacts.ts`;

    const adapter = await fsp.readFile(
      path.join(tmp, "build-tools", "tools", "tests", "template_taxonomy_adapter.bzl"),
      "utf8",
    );
    assert.match(adapter, /"ts\/pr7-synthetic"/);

    const resolverRaw = await fsp.readFile(
      path.join(tmp, "build-tools", "tools", "scaffolding", "resolver.json"),
      "utf8",
    );
    const resolver = JSON.parse(resolverRaw) as Record<string, Record<string, string>>;
    assert.equal(resolver.ts?.["pr7-synthetic"], "projects/apps/{name}");

    const runtimeTaxonomy = await fsp.readFile(
      path.join(
        tmp,
        "build-tools",
        "tools",
        "scaffolding",
        "scaf",
        "templates",
        "generated",
        "template-taxonomy.generated.ts",
      ),
      "utf8",
    );
    assert.match(runtimeTaxonomy, /"pr7-synthetic"/);
  });
});
