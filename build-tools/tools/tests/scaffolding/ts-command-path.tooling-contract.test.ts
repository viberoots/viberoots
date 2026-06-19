#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("helper tooling uses ts command path for TypeScript templates", async () => {
  const script = await fsp.readFile(
    "viberoots/build-tools/tools/scaffolding/new-pnpm-project.ts",
    "utf8",
  );
  assert.match(script, /scaf new ts \$\{template\}/);
  assert.doesNotMatch(script, /scaf new node \$\{template\}/);
});

test("manifest discoverability points TypeScript templates to templates/ts", async () => {
  const raw = await fsp.readFile("viberoots/build-tools/tools/nix/langs.json", "utf8");
  const manifest = JSON.parse(raw) as {
    languages?: Array<{ id?: string; templatesDir?: string }>;
  };
  const langs = Array.isArray(manifest.languages) ? manifest.languages : [];
  const node = langs.find((lang) => lang.id === "node");
  assert.ok(node, "expected node language entry in langs.json");
  assert.equal(
    node?.templatesDir,
    "viberoots/build-tools/tools/scaffolding/templates/ts",
    "node language templatesDir must point to canonical ts template root",
  );
});
