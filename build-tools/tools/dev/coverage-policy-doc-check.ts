#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import { getFlagStr } from "../lib/cli";

type PolicyDoc = {
  label: string;
  path: string;
  requiredFragments: string[];
};

function collectMissing(content: string, requiredFragments: string[]): string[] {
  return requiredFragments.filter((fragment) => !content.includes(fragment));
}

async function readFileOrThrow(path: string): Promise<string> {
  try {
    return await fs.readFile(path, "utf8");
  } catch (error: any) {
    throw new Error(`Failed to read ${path}: ${String(error?.message || error)}`);
  }
}

async function main() {
  const testingPath = getFlagStr("testing", "TESTING.md");
  const gettingStartedPath = getFlagStr(
    "getting-started",
    "docs/handbook/getting-started-on-a-pr.md",
  );
  const nixGapsPrsPath = getFlagStr("nix-gaps-prs", "docs/handbook/nix-gaps-prs.md");

  const docs: PolicyDoc[] = [
    {
      label: "TESTING",
      path: testingPath,
      requiredFragments: [
        "## Coverage policy (canonical)",
        "Coverage is opt-in.",
        "`i && b && v`",
        "`v --coverage`",
        "`buck2 test //... -- --env COVERAGE=1`",
      ],
    },
    {
      label: "getting-started",
      path: gettingStartedPath,
      requiredFragments: [
        "baseline pre-merge command: `i && b && v` (coverage-off by default)",
        "coverage is opt-in; only run `v --coverage` or `buck2 test //... -- --env COVERAGE=1` when explicitly required by the PR/task/CI job",
        "canonical policy location: `TESTING.md` section `Coverage policy (canonical)`",
        "Default full verify run: `v`",
        "Full verify run with coverage (opt-in): `v --coverage`",
      ],
    },
    {
      label: "nix-gaps-prs guardrails",
      path: nixGapsPrsPath,
      requiredFragments: [
        "1. Coverage remains opt-in.",
        "Keep default runs without coverage: `i && b && v` (or `buck2 test //...`).",
        "Enable coverage only when explicitly required by the PR/task/CI context:",
        "`v --coverage` or `buck2 test //... -- --env COVERAGE=1`.",
        "Evidence: `TESTING.md` section `Coverage policy (canonical)`",
      ],
    },
  ];

  const failures: string[] = [];
  for (const doc of docs) {
    const content = await readFileOrThrow(doc.path);
    const missing = collectMissing(content, doc.requiredFragments);
    if (missing.length === 0) continue;
    failures.push(`${doc.label} (${doc.path})`);
    for (const fragment of missing)
      failures.push(`- missing required policy fragment: ${fragment}`);
  }

  if (failures.length > 0) {
    console.error("Coverage policy docs mismatch:");
    for (const line of failures) console.error(line);
    process.exit(1);
  }

  console.log("coverage-policy-doc-check: OK");
}

main().catch((error) => {
  console.error(String((error as any)?.stack || error));
  process.exit(1);
});
