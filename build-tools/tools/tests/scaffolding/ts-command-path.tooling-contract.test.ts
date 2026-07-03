#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("helper tooling uses ts command path for TypeScript templates", async () => {
  const script = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/scaffolding/new-pnpm-project.ts"),
    "utf8",
  );
  assert.match(script, /scaf new ts \$\{template\}/);
  assert.doesNotMatch(script, /scaf new node \$\{template\}/);
});

test("manifest discoverability does not publish macro-only TypeScript templates as planner languages", async () => {
  const raw = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/nix/langs.json"),
    "utf8",
  );
  const manifest = JSON.parse(raw) as {
    languages?: Array<{ id?: string; templatesDir?: string }>;
  };
  const langs = Array.isArray(manifest.languages) ? manifest.languages : [];
  const node = langs.find((lang) => lang.id === "node");
  assert.equal(node, undefined, "macro-only TypeScript templates must stay out of langs.json");
});
