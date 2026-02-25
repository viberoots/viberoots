#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("smoke: synthetic manifest template is exposed via generated surfaces", async () => {
  await runInTemp("template-manifest-synthetic", async (tmp, _$) => {
    const syntheticRoot = path.join(
      tmp,
      "build-tools",
      "tools",
      "scaffolding",
      "templates",
      "ts",
      "synthetic",
    );
    await fsp.mkdir(syntheticRoot, { recursive: true });
    await fsp.writeFile(
      path.join(syntheticRoot, "meta.json"),
      JSON.stringify(
        {
          language: "ts",
          template: "synthetic",
          resolverDestination: "projects/apps/{name}",
          description: "Synthetic template",
          help: {
            usage: "scaf new ts synthetic <name>",
            notes: ["synthetic test template"],
            examples: ["scaf new ts synthetic demo --yes --dry-run"],
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
    assert.match(adapter, /"ts\/synthetic"/);

    const resolverRaw = await fsp.readFile(
      path.join(tmp, "build-tools", "tools", "scaffolding", "resolver.json"),
      "utf8",
    );
    const resolver = JSON.parse(resolverRaw) as Record<string, Record<string, string>>;
    assert.equal(resolver.ts?.["synthetic"], "projects/apps/{name}");

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
    assert.match(runtimeTaxonomy, /"synthetic"/);
  });
});
