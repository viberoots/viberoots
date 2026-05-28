#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

async function ciSourceFiles(dir = "build-tools/tools/ci"): Promise<string[]> {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await ciSourceFiles(p)));
    if (entry.isFile() && p.endsWith(".ts")) files.push(p);
  }
  return files;
}

async function ciEntrypointFiles(): Promise<string[]> {
  return [...(await ciSourceFiles()), "Jenkinsfile"];
}

test("ci buck-test stage uses the shared verify selection resolver", async () => {
  const txt = await fsp.readFile("build-tools/tools/ci/buck-test-stage.ts", "utf8");
  assert.ok(
    txt.includes("resolveRequestedVerifyScope"),
    "expected CI buck-test stage to use the shared verify-selection resolver",
  );
  assert.ok(
    txt.includes("summarizeVerifyScopeDecision"),
    "expected CI buck-test stage to print auditable selection summaries",
  );
  assert.ok(
    txt.includes("[ci] buck-test selection:"),
    "expected CI buck-test stage to log the resolved selection",
  );
});

test("ci buck-test stage delegates Buck execution through verify passes", async () => {
  const txt = await fsp.readFile("build-tools/tools/ci/buck-test-stage.ts", "utf8");
  assert.ok(
    txt.includes("runVerifyBuckPasses"),
    "expected CI buck-test stage to use verify pass orchestration",
  );
  assert.ok(
    txt.includes("parseVerifyExecutionPolicy"),
    "expected future remote policy env to flow through verify execution policy parsing",
  );
  assert.ok(
    !txt.includes("buck2 test"),
    "expected no raw buck2 test invocation in buck-test stage",
  );
  assert.ok(
    txt.includes('process.env.COVERAGE === "1"'),
    "expected coverage mode to be preserved when parsing verify execution policy",
  );
});

test("ci buck-test stage preserves legacy timeout as exact verify timeout", async () => {
  const stage = await fsp.readFile("build-tools/tools/ci/buck-test-stage.ts", "utf8");
  const verifyPasses = await fsp.readFile("build-tools/tools/dev/verify/verify-passes.ts", "utf8");
  const buck2Test = await fsp.readFile("build-tools/tools/dev/verify/buck2-test.ts", "utf8");
  assert.ok(stage.includes("Number(process.env.TIMEOUT_SEC || 1200)"));
  assert.ok(stage.includes("exactOverallTimeoutSecs: ciBuckTestTimeoutSecs()"));
  assert.ok(verifyPasses.includes("exactOverallTimeoutSecs?: number"));
  assert.ok(buck2Test.includes("opts.exactOverallTimeoutSecs ?? Math.max"));
  assert.ok(!stage.includes("VERIFY_TIMEOUT_SECS"));
});

test("local-only cpp addon smoke scrubs broad remote Buck env", async () => {
  const txt = await fsp.readFile("build-tools/tools/ci/cpp-addon-smoke.ts", "utf8");
  assert.ok(txt.includes("scrubRemoteBuckEnv"), "expected explicit local-only env scrub helper");
  assert.ok(
    txt.includes('key.startsWith("VBR_REMOTE_")'),
    "expected local-only direct Buck smoke to scrub remote policy env vars",
  );
});

test("direct CI Buck invocations are either verify-routed or local-only scrubbed", async () => {
  const files = await ciEntrypointFiles();
  for (const file of files) {
    const txt = await fsp.readFile(file, "utf8");
    if (!/buck2 (build|test)/.test(txt)) continue;
    assert.ok(
      txt.includes("scrubRemoteBuckEnv"),
      `expected ${file} direct Buck calls to be marked local-only with remote env scrubbing`,
    );
  }
});

test("Jenkins buck-test defaults do not set remote verify policy env", async () => {
  const txt = await fsp.readFile("Jenkinsfile", "utf8");
  const buckTestLines = txt.split(/\r?\n/).filter((line) => line.includes("--stage buck-test"));
  assert.ok(buckTestLines.length > 0, "expected Jenkins buck-test stage wiring");
  assert.ok(
    buckTestLines.every((line) => !line.includes("VBR_REMOTE_")),
    "expected Jenkins buck-test defaults to remain local-only",
  );
});
