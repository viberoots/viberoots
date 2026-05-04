#!/usr/bin/env zx-wrapper
import { readPatchesLintConfig } from "./patches-lint/config";
import { lintCpp } from "./patches-lint/lint-cpp";
import { lintGo } from "./patches-lint/lint-go";
import { lintNode } from "./patches-lint/lint-node";
import { lintPython } from "./patches-lint/lint-python";

async function main() {
  const cfg = readPatchesLintConfig();
  let problems = 0;
  const langs = ["go", "node", "cpp", "python"] as const;
  for (const l of langs) {
    if (cfg.lang && cfg.lang !== l) continue;
    if (l === "go") problems += await lintGo(cfg);
    else if (l === "node") problems += await lintNode(cfg);
    else if (l === "cpp") problems += await lintCpp(cfg);
    else if (l === "python") problems += await lintPython(cfg);
  }
  if (cfg.strict && problems > 0) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
