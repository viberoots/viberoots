#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  ALLOW_COMMENT,
  collectIsolationFragmentHelpersForFiles,
  collectRunInTempScanFiles,
  findExplicitIsolationViolations,
  normalizeRelPath,
} from "./run-in-temp-buck-isolation-lint.ts";

const SELF_TEST_PATH =
  "build-tools/tools/tests/linting/run-in-temp.no-hardcoded-buck-isolations.enforcement.test.ts";

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

test("runInTemp isolation lint scans imported helper files", async () => {
  const repo = await fsp.mkdtemp(path.join(process.cwd(), "buck-out/tmp/isolation-lint-"));
  const tests = path.join(repo, "build-tools/tools/tests/linting");
  await fsp.mkdir(tests, { recursive: true });
  await fsp.writeFile(
    path.join(tests, "fixture.test.ts"),
    'import { buckWithIso } from "./fixture-helper";\nrunInTemp("x", () => buckWithIso("x"));\n',
    "utf8",
  );
  const helper = path.join(tests, "fixture-helper.ts");
  await fsp.writeFile(
    helper,
    "export function buckWithIso(iso: string): string { return `buck2 --isolation-dir ${iso} build //:x`; }\n",
    "utf8",
  );
  const scanned = (await collectRunInTempScanFiles(repo)).map((file) =>
    normalizeRelPath(path.relative(repo, file)),
  );
  if (!scanned.includes("build-tools/tools/tests/linting/fixture-helper.ts")) {
    throw new Error(`expected helper to be scanned, got ${JSON.stringify(scanned)}`);
  }
  const helpers = await collectIsolationFragmentHelpersForFiles(
    scanned.map((file) => path.join(repo, file)),
  );
  if (helpers.length !== 0) {
    throw new Error(`expected no fragment helpers, got ${JSON.stringify(helpers)}`);
  }
  await fsp.rm(repo, { recursive: true, force: true });
});

test("runInTemp isolation lint composes imported helper-returned fragments", async () => {
  const helperBodies = [
    "export function isoFlag(tmp: string): string { return `--isolation-dir ${isoForTmp(tmp)}`; }",
    "export const isoFlag = (tmp: string): string => `--isolation-dir ${isoForTmp(tmp)}`;",
  ];
  for (const helperBody of helperBodies) {
    const repo = await fsp.mkdtemp(path.join(process.cwd(), "buck-out/tmp/isolation-fragment-"));
    const tests = path.join(repo, "build-tools/tools/tests/linting");
    await fsp.mkdir(tests, { recursive: true });
    const testFile = path.join(tests, "fixture.test.ts");
    await fsp.writeFile(
      testFile,
      [
        'import { runInTemp } from "../lib/test-helpers";',
        'import { isoFlag } from "./fixture-helper";',
        'runInTemp("x", async (tmp, $) => $`buck2 ${isoFlag(tmp)} build //:x`);',
        "",
      ].join("\n"),
      "utf8",
    );
    await fsp.writeFile(path.join(tests, "fixture-helper.ts"), `${helperBody}\n`, "utf8");
    const scanned = await collectRunInTempScanFiles(repo);
    const helpers = await collectIsolationFragmentHelpersForFiles(scanned);
    if (!helpers.includes("isoFlag")) {
      throw new Error(`expected fragment helper to be collected, got ${JSON.stringify(helpers)}`);
    }
    const hits = findExplicitIsolationViolations(
      await fsp.readFile(testFile, "utf8"),
      "build-tools/tools/tests/linting/fixture.test.ts",
      helpers,
    );
    if (hits.length !== 1 || !hits[0]?.reason.includes("fragment")) {
      throw new Error(`expected composed helper-fragment violation, got ${JSON.stringify(hits)}`);
    }
    await fsp.rm(repo, { recursive: true, force: true });
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
    if (rel === SELF_TEST_PATH) continue;
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
