#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { CANONICAL_TS_TEMPLATE_IDS } from "../../scaffolding/scaf/templates/taxonomy";

const DOCS_WITH_REQUIRED_TS_EXAMPLES: Array<{ path: string; requiredFragments: string[] }> = [
  {
    path: "docs/handbook/node-tests.md",
    requiredFragments: ["scaf new ts ..."],
  },
  {
    path: "build-tools/docs/node-call-cpp.md",
    requiredFragments: ["scaf new ts cpp-addon <name>", "scaf new ts cpp-addon demo"],
  },
  {
    path: "build-tools/docs/node-cpp-addon-plan.md",
    requiredFragments: ["scaf new ts cpp-addon demo"],
  },
  {
    path: "docs/history/designs/legacy/pnpm-pr-8.5.md",
    requiredFragments: ["scaf new ts webapp-static <name>", "scaf new ts webapp-static demo --yes"],
  },
  {
    path: "docs/history/designs/legacy/nix-node-test.md",
    requiredFragments: ["scaf new ts lib", "scaf new ts cli"],
  },
  {
    path: "build-tools/docs/scaffolding.md",
    requiredFragments: [
      "scaf new ts webapp-ssr-vite demo-vite-ssr --yes",
      "build-tools/tools/dev/build-wasm-producer.ts",
    ],
  },
];

function canonicalTsTemplatesPattern(): RegExp {
  const templates = CANONICAL_TS_TEMPLATE_IDS.map((id) => id.split("/")[1]).filter(Boolean);
  const body = templates.map((name) => name.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")).join("|");
  return new RegExp(`scaf\\s+new\\s+node\\s+(${body})(?:\\s|$)`);
}

test("docs contract: no canonical TypeScript examples route through scaf new node", async () => {
  const oldNodePattern = canonicalTsTemplatesPattern();
  for (const doc of DOCS_WITH_REQUIRED_TS_EXAMPLES) {
    const content = await fsp.readFile(doc.path, "utf8");
    assert.doesNotMatch(
      content,
      oldNodePattern,
      `${doc.path} still contains legacy node command path`,
    );
    for (const fragment of doc.requiredFragments) {
      assert.match(content, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  }
});
