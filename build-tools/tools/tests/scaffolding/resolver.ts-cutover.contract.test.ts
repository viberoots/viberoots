#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { CANONICAL_TS_TEMPLATE_IDS } from "../../scaffolding/scaf/templates/taxonomy";

type ResolverConfig = Record<string, Record<string, string>>;

test("resolver keeps canonical TypeScript templates under ts only", async () => {
  const raw = await fsp.readFile("build-tools/tools/scaffolding/resolver.json", "utf8");
  const cfg = JSON.parse(raw) as ResolverConfig;

  const ts = cfg.ts || {};
  const node = cfg.node || {};
  for (const id of CANONICAL_TS_TEMPLATE_IDS) {
    const parts = id.split("/");
    const template = parts[1] || "";
    assert.ok(template.length > 0, `invalid canonical template id: ${id}`);
    assert.equal(typeof ts[template], "string", `missing ts resolver mapping for ${id}`);
    assert.equal(
      node[template],
      undefined,
      `legacy node resolver mapping must be removed for ${id}`,
    );
  }
});
