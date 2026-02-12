#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

const scriptPath = "build-tools/tools/dev/coverage-policy-doc-check.ts";

const testingDoc = `# Testing

## Coverage policy (canonical)

Coverage is opt-in.

- Default local and pre-merge verification runs use coverage-off commands:
  - \`i && b && v\`
  - \`buck2 test //...\`
- Enable coverage only when a PR, task, or CI job explicitly requires it:
  - \`v --coverage\`
  - \`buck2 test //... -- --env COVERAGE=1\`
`;

const gettingStartedDoc = `## Getting Started on a PR — Practical Guide for This Repository

- Never commit without verifying that all tests are wired and passing:
  - baseline pre-merge command: \`i && b && v\` (coverage-off by default)
  - coverage is opt-in; only run \`v --coverage\` or \`buck2 test //... -- --env COVERAGE=1\` when explicitly required by the PR/task/CI job
  - canonical policy location: \`TESTING.md\` section \`Coverage policy (canonical)\`

- Build/test:
  - Default full verify run: \`v\`
  - Full verify run with coverage (opt-in): \`v --coverage\`
`;

const nixGapsPrsDoc = `# Nix Gaps PR Plan

## Test-time guardrails (evidence-based, required for PR-12+)

1. Coverage remains opt-in.
   - Keep default runs without coverage: \`i && b && v\` (or \`buck2 test //...\`).
   - Enable coverage only when explicitly required by the PR/task/CI context:
     \`v --coverage\` or \`buck2 test //... -- --env COVERAGE=1\`.
   - Evidence: \`TESTING.md\` section \`Coverage policy (canonical)\` documents default coverage-off
     and explicit opt-in.
`;

test("coverage-policy-doc-check passes when policy docs are aligned", async () => {
  await runInTemp("coverage-policy-doc-check-pass", async (tmp, $) => {
    await fs.outputFile(path.join(tmp, scriptPath), await fs.readFile(scriptPath, "utf8"));
    await fs.outputFile(path.join(tmp, "TESTING.md"), testingDoc);
    await fs.outputFile(
      path.join(tmp, "docs/handbook/getting-started-on-a-pr.md"),
      gettingStartedDoc,
    );
    await fs.outputFile(path.join(tmp, "docs/handbook/nix-gaps-prs.md"), nixGapsPrsDoc);

    await $({
      cwd: tmp,
    })`node ${scriptPath} --testing TESTING.md --getting-started docs/handbook/getting-started-on-a-pr.md --nix-gaps-prs docs/handbook/nix-gaps-prs.md`;
  });
});

test("coverage-policy-doc-check fails when one policy fragment drifts", async () => {
  await runInTemp("coverage-policy-doc-check-fail", async (tmp, $) => {
    await fs.outputFile(path.join(tmp, scriptPath), await fs.readFile(scriptPath, "utf8"));
    await fs.outputFile(path.join(tmp, "TESTING.md"), testingDoc);
    await fs.outputFile(
      path.join(tmp, "docs/handbook/getting-started-on-a-pr.md"),
      gettingStartedDoc.replace(
        "Default full verify run: `v`",
        "Default full verify run: `buck2 test //...`",
      ),
    );
    await fs.outputFile(path.join(tmp, "docs/handbook/nix-gaps-prs.md"), nixGapsPrsDoc);

    const res = await $({
      cwd: tmp,
      stdio: "pipe",
    })`node ${scriptPath} --testing TESTING.md --getting-started docs/handbook/getting-started-on-a-pr.md --nix-gaps-prs docs/handbook/nix-gaps-prs.md`.nothrow();
    assert.notEqual(res.exitCode, 0);
    assert.match(String(res.stderr || ""), /missing required policy fragment/);
  });
});
