#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

async function read(path: string): Promise<string> {
  return fsp.readFile(path, "utf8");
}

test("webapp-static-pwa docs cover template selection and validation guidance", async () => {
  const [meta, readmeTemplate, scaffoldingDoc] = await Promise.all([
    read("viberoots/build-tools/tools/scaffolding/templates/ts/webapp-static-pwa/meta.json"),
    read("viberoots/build-tools/tools/scaffolding/templates/ts/README.md.jinja"),
    read("viberoots/build-tools/docs/scaffolding.md"),
  ]);

  assert.match(meta, /Choose webapp-static when you want a simple static site/);
  assert.match(meta, /If important client state only exists in the URL hash or browser storage/);
  assert.match(meta, /Validate PWA install\/offline behavior on a real local origin/);
  assert.match(meta, /wasm producers and worker entrypoints/);

  assert.match(readmeTemplate, /SSR and hash-persisted client state do not mix well:/);
  assert.match(readmeTemplate, /pnpm run preview -- --host 127\.0\.0\.1 --port 4173/);
  assert.match(
    readmeTemplate,
    /Do not hand-maintain service-worker cache lists for wasm or worker files\./,
  );

  assert.match(scaffoldingDoc, /Static vs PWA vs SSR selection guidance:/);
  assert.match(
    scaffoldingDoc,
    /Hash-only or browser-storage-only client state is a poor fit for SSR-first ownership/,
  );
  assert.match(scaffoldingDoc, /Local-origin PWA validation guidance:/);
  assert.match(
    scaffoldingDoc,
    /Shared static-PWA precache materialization should remain authoritative/,
  );
});
