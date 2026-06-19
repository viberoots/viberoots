#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("e2e: canonical path onboarding wires conventions without template_keys", async () => {
  await runInTemp("template-conventions-onboarding", async (tmp, _$) => {
    const templateRoot = path.join(
      tmp,
      "viberoots",
      "build-tools",
      "tools",
      "scaffolding",
      "templates",
      "ts",
      "synthetic",
    );
    await fsp.mkdir(templateRoot, { recursive: true });
    await fsp.writeFile(path.join(templateRoot, "copier.yaml"), 'language: "ts"\n', "utf8");
    await fsp.writeFile(
      path.join(templateRoot, "meta.json"),
      JSON.stringify(
        {
          language: "ts",
          template: "synthetic",
          resolverDestination: "projects/apps/{name}",
          description: "Synthetic template",
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );

    const manifestBefore = await fsp.readFile(
      path.join(tmp, "viberoots", "build-tools", "tools", "scaffolding", "template-manifest.json"),
      "utf8",
    );

    const $ = _$({ stdio: "pipe" });
    await $`node viberoots/build-tools/tools/scaffolding/gen-template-manifest-artifacts.ts`;
    const resolverRaw = await fsp.readFile(
      path.join(tmp, "viberoots", "build-tools", "tools", "scaffolding", "resolver.json"),
      "utf8",
    );
    const resolver = JSON.parse(resolverRaw) as Record<string, Record<string, string>>;
    assert.equal(resolver.ts?.["synthetic"], "projects/apps/{name}");

    const manifestAfter = await fsp.readFile(
      path.join(tmp, "viberoots", "build-tools", "tools", "scaffolding", "template-manifest.json"),
      "utf8",
    );
    assert.equal(manifestBefore, manifestAfter);

    await $`zx-wrapper viberoots/build-tools/tools/tests/scaffolding/template-taxonomy.parity-contract.test.ts`;
  });
});
