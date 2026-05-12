#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  ALLOW_COMMENT,
  collectIsolationFragmentHelpersForFiles,
  findExplicitIsolationViolations,
  normalizeRelPath,
} from "./run-in-temp-buck-isolation-lint.ts";
import { collectRunInTempScanFiles } from "./run-in-temp-buck-isolation-graph.ts";

const SELF_TEST_PREFIX = "build-tools/tools/tests/linting/run-in-temp.";

test("runInTemp isolation lint catches computed explicit buck isolations", () => {
  const bad = String.raw`
import { runInTemp } from "../lib/test-helpers";
await runInTemp("bad", async (tmp, $) => {
  const iso = isoForTmp(tmp);
  await $\`buck2 --isolation-dir \${iso} build //:x\`;
  await $\`buck2 --isolation-dir \${isoForTmp(tmp)} test //:x\`;
});
`;
  const hits = findExplicitIsolationViolations(bad);
  if (hits.length !== 2) {
    throw new Error(`expected 2 violations, got ${JSON.stringify(hits)}`);
  }
});

test("runInTemp isolation lint catches multiline, split, and array command forms", () => {
  const bad = String.raw`
import { runInTemp } from "../lib/test-helpers";
await runInTemp("bad", async (tmp, $) => {
  await $\`buck2
    --isolation-dir \${iso}
    build //:x\`;
  await $(["buck2", "--isolation-dir", isoForTmp(tmp), "test", "//:x"]);
});
`;
  const hits = findExplicitIsolationViolations(bad);
  if (hits.length !== 2) {
    throw new Error(`expected 2 violations, got ${JSON.stringify(hits)}`);
  }
});

test("runInTemp isolation lint catches helper-generated commands", () => {
  const helper = String.raw`
export function buckWithIso(tmp: string): string {
  return \`buck2 --isolation-dir \${isoForTmp(tmp)} build //:x\`;
}
`;
  const hits = findExplicitIsolationViolations(helper);
  if (hits.length !== 1) {
    throw new Error(`expected 1 violation, got ${JSON.stringify(hits)}`);
  }
});

test("runInTemp isolation lint catches helper-generated isolation fragments", () => {
  const helper = String.raw`
export function isoFlag(tmp: string): string {
  return \`--isolation-dir \${isoForTmp(tmp)}\`;
}
`;
  const caller = String.raw`
import { runInTemp } from "../lib/test-helpers";
import { isoFlag } from "./fixture-helper";
await runInTemp("bad", async (tmp, $) => {
  await $\`buck2 \${isoFlag(tmp)} build //:x\`;
});
`;
  const hits = findExplicitIsolationViolations(caller, "fixture.test.ts", ["isoFlag"]);
  if (hits.length !== 1 || !hits[0]?.reason.includes("fragment")) {
    throw new Error(`expected helper-fragment violation, got ${JSON.stringify(hits)}`);
  }
  const helperHits = findExplicitIsolationViolations(helper);
  if (helperHits.length !== 0) {
    throw new Error(
      `expected fragment helper alone to avoid direct-command hits, got ${JSON.stringify(helperHits)}`,
    );
  }
});

test("runInTemp isolation lint accepts shim and inherited isolation patterns", () => {
  const good = String.raw`
import { inheritedBuckIsolation, runInTemp } from "../lib/test-helpers";
await runInTemp("good", async (tmp, $) => {
  await $\`buck2 build //:x\`;
  await $\`buck2 --isolation-dir \${inheritedBuckIsolation("good")} cquery //:x\`;
});
`;
  const hits = findExplicitIsolationViolations(good);
  if (hits.length !== 0) {
    throw new Error(`expected no violations, got ${JSON.stringify(hits)}`);
  }
});

test("runInTemp isolation lint accepts justified allow comments", () => {
  const good = String.raw`
import { runInTemp } from "../lib/test-helpers";
await runInTemp("good", async (tmp, $) => {
  // ${ALLOW_COMMENT}: validates isolated cache invalidation with a separate daemon
  await $\`buck2 --isolation-dir separate build //:x\`;
});
`;
  const hits = findExplicitIsolationViolations(good);
  if (hits.length !== 0) {
    throw new Error(`expected no violations, got ${JSON.stringify(hits)}`);
  }
});

test("runInTemp isolation lint requires allow-comment justification", () => {
  const bad = String.raw`
import { runInTemp } from "../lib/test-helpers";
await runInTemp("bad", async (tmp, $) => {
  // ${ALLOW_COMMENT}
  await $\`buck2 --isolation-dir separate build //:x\`;
});
`;
  const hits = findExplicitIsolationViolations(bad);
  if (hits.length !== 1 || !hits[0]?.reason.includes("justification")) {
    throw new Error(`expected missing-justification violation, got ${JSON.stringify(hits)}`);
  }
});

test("runInTemp tests reuse inherited buck isolation unless explicitly opted out", async () => {
  const repoRoot = process.cwd();
  const files = await collectRunInTempScanFiles(repoRoot);
  const isolationFragmentHelpers = await collectIsolationFragmentHelpersForFiles(files);
  const hits: Array<{ file: string; line: number; reason: string }> = [];

  for (const abs of files) {
    const rel = normalizeRelPath(path.relative(repoRoot, abs));
    if (rel.startsWith(SELF_TEST_PREFIX)) continue;
    const text = await fsp.readFile(abs, "utf8");
    for (const hit of findExplicitIsolationViolations(text, rel, isolationFragmentHelpers)) {
      hits.push({
        file: rel,
        line: hit.line,
        reason: hit.reason,
      });
    }
  }

  if (hits.length > 0) {
    const details = hits
      .slice(0, 50)
      .map(
        (hit) =>
          `- ${hit.file}:${hit.line} ${hit.reason}; use plain buck2 so the shim injects the registered isolation, or inheritedBuckIsolation(...) when the isolation must be explicit`,
      )
      .join("\n");
    const tail = hits.length > 50 ? `\n... and ${hits.length - 50} more` : "";
    throw new Error(
      [
        "Found runInTemp tests with explicit Buck isolation names.",
        "These tests already have registered temp-repo isolation, so independent nested Buck isolations bypass verify cleanup.",
        `If a test truly requires an independent nested daemon, add '${ALLOW_COMMENT}: <why this cannot reuse the registered isolation>'.`,
        "",
        details + tail,
      ].join("\n"),
    );
  }
});
