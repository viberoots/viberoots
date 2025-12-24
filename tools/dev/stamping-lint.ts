#!/usr/bin/env zx-wrapper
import "zx/globals";

import * as fsp from "node:fs/promises";
import path from "node:path";
import { isAllowedKindLabel } from "../lib/kind-vocabulary.ts";

type Row = { name: string; rule_type: string; labels?: string[] };

function kindLabelsOf(labels: string[]): string[] {
  return labels.filter((l) => typeof l === "string" && l.startsWith("kind:"));
}

function validateKindLabels(name: string, kindLabels: string[], problems: string[]) {
  const uniq = [...new Set(kindLabels)];
  for (const k of uniq) {
    if (!isAllowedKindLabel(k)) problems.push(`${name} has invalid kind label: ${k}`);
  }
  const distinctKinds = new Set(uniq.map((k) => k.slice("kind:".length)));
  if (distinctKinds.size > 1) {
    problems.push(`${name} has multiple kind labels: ${uniq.join(", ")}`);
  }
}

async function main() {
  const problems: string[] = [];
  try {
    const { stdout } =
      await $`buck2 cquery 'deps(//..., 1, exec_deps())' --target-platform config//platforms:default --json --output-attribute name --output-attribute rule_type --output-attribute labels`.quiet();
    let arr: Row[] = [];
    try {
      arr = JSON.parse(String(stdout || ""));
    } catch {
      arr = [];
    }
    for (const n of arr) {
      const labs = Array.isArray(n.labels) ? n.labels : [];
      // Go
      const looksGo = (n.rule_type || "").startsWith("go_");
      if (looksGo && !labs.includes("lang:go")) problems.push(`${n.name} missing label lang:go`);
      // C++
      const looksCpp = (n.rule_type || "").startsWith("cxx_");
      if (looksCpp && !labs.includes("lang:cpp")) problems.push(`${n.name} missing label lang:cpp`);
      validateKindLabels(n.name, kindLabelsOf(labs), problems);
    }
  } catch {
    // Fallback: lightweight TARGETS scan in minimal repos without invoking Buck
    async function* walk(dir: string): AsyncGenerator<string> {
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.name === "node_modules" || e.name === ".direnv" || e.name === "buck-out") continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          yield* walk(p);
        } else if (e.isFile() && e.name === "TARGETS") {
          yield p;
        }
      }
    }
    for await (const f of walk(process.cwd())) {
      const content = await fsp.readFile(f, "utf8");
      const hasGoRule = /\b(go_library|go_binary|go_test)\s*\(/.test(content);
      const hasLangGo = content.includes("lang:go");
      if (hasGoRule && !hasLangGo) problems.push(`${f} missing label lang:go`);
      const hasCppRule = /\b(cxx_library|cxx_binary|cxx_test)\s*\(/.test(content);
      const hasLangCpp = content.includes("lang:cpp");
      if (hasCppRule && !hasLangCpp) problems.push(`${f} missing label lang:cpp`);

      // kind label vocabulary validation (best-effort)
      const matches = content.match(/\bkind:[A-Za-z0-9_-]+\b/g) || [];
      validateKindLabels(f, matches, problems);
    }
  }
  if (problems.length) {
    console.error("stamping-lint errors:\n" + problems.map((s) => `- ${s}`).join("\n"));
    process.exit(1);
  }
  console.log("stamping-lint: OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
