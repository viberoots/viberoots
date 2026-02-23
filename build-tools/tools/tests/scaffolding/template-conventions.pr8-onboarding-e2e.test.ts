#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("PR-8 e2e: canonical path onboarding wires conventions without template_keys", async () => {
  await runInTemp("template-conventions-pr8-onboarding", async (tmp, _$) => {
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
          resolverDestination: "projects/apps/{name}",
          description: "PR-8 synthetic template",
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );

    const manifestBefore = await fsp.readFile(
      path.join(tmp, "build-tools", "tools", "scaffolding", "template-manifest.json"),
      "utf8",
    );

    const $ = _$({ stdio: "pipe" });
    await $`node build-tools/tools/scaffolding/gen-template-manifest-artifacts.ts`;
    const resolverRaw = await fsp.readFile(
      path.join(tmp, "build-tools", "tools", "scaffolding", "resolver.json"),
      "utf8",
    );
    const resolver = JSON.parse(resolverRaw) as Record<string, Record<string, string>>;
    assert.equal(resolver.ts?.["pr8-synthetic"], "projects/apps/{name}");

    const manifestAfter = await fsp.readFile(
      path.join(tmp, "build-tools", "tools", "scaffolding", "template-manifest.json"),
      "utf8",
    );
    assert.equal(manifestBefore, manifestAfter);

    await $`node build-tools/tools/tests/scaffolding/template-taxonomy.pr4-parity-contract.test.ts`;
  });
});
