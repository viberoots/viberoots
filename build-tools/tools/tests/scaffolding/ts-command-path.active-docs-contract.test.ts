#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { CANONICAL_TS_TEMPLATE_IDS } from "../../scaffolding/scaf/templates/taxonomy";
import {
  ACTIVE_DOC_COMMAND_CONTRACT,
  ARCHIVAL_DOC_COMMAND_CONTRACT,
  allClassifiedDocPaths,
} from "./doc-command-contract.inventory";

const DOC_SCOPE_ROOTS = [
  "docs/handbook",
  "build-tools/docs",
  "docs/design-history",
  "docs/pnpm",
] as const;

function escapeRegexFragment(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function canonicalTsTemplatesPattern(): RegExp {
  const templates = CANONICAL_TS_TEMPLATE_IDS.map((id) => id.split("/")[1]).filter(Boolean);
  const body = templates.map(escapeRegexFragment).join("|");
  return new RegExp(`scaf\\s+new\\s+node\\s+(${body})(?:\\s|$)`);
}

function hasScaffoldCommand(content: string): boolean {
  return /scaf\s+(new|help)\s+(ts|node)\s+\S+/.test(content);
}

async function listMarkdownFilesRecursively(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(current: string): Promise<void> {
    const entries = await fsp.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".md")) {
        out.push(full.replace(/\\/g, "/"));
      }
    }
  }
  await walk(root);
  return out.sort();
}

test("docs contract: active docs use ts command paths for canonical TypeScript templates", async () => {
  const legacyPattern = canonicalTsTemplatesPattern();
  for (const doc of ACTIVE_DOC_COMMAND_CONTRACT) {
    const content = await fsp.readFile(doc.path, "utf8");
    assert.doesNotMatch(
      content,
      legacyPattern,
      `${doc.path} still contains legacy node command path`,
    );
    for (const fragment of doc.requiredFragments) {
      assert.match(content, new RegExp(escapeRegexFragment(fragment)));
    }
  }
});

test("docs contract: inventory classification is explicit, unique, and scoped", async () => {
  const activePaths = ACTIVE_DOC_COMMAND_CONTRACT.map((entry) => entry.path);
  const allClassified = allClassifiedDocPaths();
  const uniqueClassified = new Set(allClassified);
  assert.equal(
    allClassified.length,
    uniqueClassified.size,
    "duplicate doc paths in classification inventory",
  );
  for (const activePath of activePaths) {
    assert.ok(
      !ARCHIVAL_DOC_COMMAND_CONTRACT.includes(activePath),
      `${activePath} cannot be active and archival`,
    );
  }

  const candidateDocs: string[] = [];
  for (const root of DOC_SCOPE_ROOTS) {
    const docs = await listMarkdownFilesRecursively(root);
    for (const doc of docs) {
      const content = await fsp.readFile(doc, "utf8");
      if (hasScaffoldCommand(content)) {
        candidateDocs.push(doc);
      }
    }
  }

  const unclassified = candidateDocs.filter((doc) => !uniqueClassified.has(doc));
  assert.deepEqual(
    unclassified,
    [],
    [
      "scaffold-command docs must be classified as active or archival.",
      "Update doc-command-contract.inventory.ts when adding/rewriting implementation docs.",
    ].join(" "),
  );
});
