#!/usr/bin/env zx-wrapper
import "zx/globals";

import * as fsp from "node:fs/promises";
import path from "node:path";
import { isAllowedKindLabel } from "../lib/kind-vocabulary";
import { patchInvalidationStrategyForLang } from "../lib/lang-contracts";
import { normalizeTargetLabel } from "../lib/labels";

type Row = {
  name: string;
  rule_type?: string;
  "buck.type"?: string;
  labels?: string[];
  // buck2 cquery may return this as buck.package
  "buck.package"?: string;
};

function kindLabelsOf(labels: string[]): string[] {
  return labels.filter((l) => typeof l === "string" && l.startsWith("kind:"));
}

function parseCqueryRows(stdout: string): Row[] {
  try {
    const parsed: unknown = JSON.parse(String(stdout || ""));
    if (Array.isArray(parsed)) return parsed as Row[];
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      const out: Row[] = [];
      for (const v of Object.values(obj)) {
        if (Array.isArray(v)) {
          out.push(...(v as Row[]));
        } else if (v && typeof v === "object") {
          out.push(v as Row);
        }
      }
      return out;
    }
  } catch {}
  return [];
}

function validateKindLabels(name: string, kindLabels: string[], problems: string[]) {
  const uniq = [...new Set(kindLabels)];
  for (const k of uniq) {
    if (!isAllowedKindLabel(k)) problems.push(`${name} has invalid kind label: ${k}`);
  }
  const distinctKinds = new Set(uniq.map((k) => k.slice("kind:".length)));
  // kind:wasm is a wasm-variant co-classification; it may coexist with one primary kind
  // (e.g. kind:lib on C++ emscripten targets that are also wasm artifacts).
  const nonWasmKinds = [...distinctKinds].filter((k) => k !== "wasm");
  if (nonWasmKinds.length > 1) {
    problems.push(`${name} has multiple kind labels: ${uniq.join(", ")}`);
  }
}

function langLabelsOf(labels: string[]): string[] {
  return labels.filter((l) => typeof l === "string" && l.startsWith("lang:"));
}

function patchScopeLabelsOf(labels: string[]): string[] {
  return labels.filter((l) => typeof l === "string" && l.startsWith("patch_scope:"));
}

function validatePatchScopeLabels(name: string, labels: string[], problems: string[]) {
  const langs = [...new Set(langLabelsOf(labels))];
  if (langs.length === 0) return;
  if (langs.length > 1) {
    problems.push(`${name} has multiple lang labels: ${langs.join(", ")}`);
    return;
  }
  const lang = langs[0]!.slice("lang:".length);
  const strat = patchInvalidationStrategyForLang(lang);
  if (!strat) return; // ignore unknown langs

  const patchScopes = [...new Set(patchScopeLabelsOf(labels))];
  const expected = `patch_scope:${strat.patchScope}`;
  if (patchScopes.length === 0) {
    problems.push(`${name} missing label ${expected}`);
    return;
  }
  if (patchScopes.length > 1) {
    problems.push(`${name} has multiple patch_scope labels: ${patchScopes.join(", ")}`);
    return;
  }
  const got = patchScopes[0]!;
  if (got !== expected) {
    problems.push(`${name} has wrong patch_scope label: ${got} (expected ${expected})`);
  }
}

function labelTokensFromText(content: string): string[] {
  const labelLiterals = content.match(/\b(?:lang|kind|patch_scope):[A-Za-z0-9._/-]+\b/g) || [];
  return [...new Set(labelLiterals)];
}

async function main() {
  const problems: string[] = [];
  const buckIsolationDir = String(process.env.BUCK_ISOLATION_DIR || "").trim();
  const isolationFlags = buckIsolationDir ? ["--isolation-dir", buckIsolationDir] : [];
  try {
    const { stdout } =
      // Do not force a platform label here; rely on repo (or temp-repo) buckconfig defaults.
      // Query all targets, not only deps(...): leaf/root targets with no deps still need validation.
      // Note: Buck2 deprecated --output-attributes; keep using repeated --output-attribute for compatibility.
      await $`buck2 ${isolationFlags} cquery '//...' --target-platforms config//platforms:default --json --output-attribute name --output-attribute buck.type --output-attribute labels --output-attribute package`.quiet();
    const arr = parseCqueryRows(String(stdout || ""));
    for (const n of arr) {
      const labsRaw: unknown = Array.isArray((n as any).labels)
        ? (n as any).labels
        : (n as any)["buck.labels"];
      const labs = Array.isArray(labsRaw) ? (labsRaw as unknown[]).map(String) : [];
      const buckPkg = normalizeTargetLabel(String((n as any)["buck.package"] || ""));
      const isProviderPkg = buckPkg.startsWith("//third_party/providers:");
      const ruleType = String((n as any)["buck.type"] || (n as any).rule_type || "");
      // Go
      const looksGo = ruleType.startsWith("go_");
      if (looksGo && !labs.includes("lang:go")) problems.push(`${n.name} missing label lang:go`);
      // C++
      const looksCpp = ruleType.startsWith("cxx_");
      if (looksCpp && !labs.includes("lang:cpp")) problems.push(`${n.name} missing label lang:cpp`);
      validateKindLabels(n.name, kindLabelsOf(labs), problems);
      if (!isProviderPkg) validatePatchScopeLabels(n.name, labs, problems);
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
      const labels = labelTokensFromText(content);
      const hasGoRule = /\b(go_library|go_binary|go_test)\s*\(/.test(content);
      const hasLangGo = content.includes("lang:go");
      if (hasGoRule && !hasLangGo) problems.push(`${f} missing label lang:go`);
      const hasCppRule = /\b(cxx_library|cxx_binary|cxx_test)\s*\(/.test(content);
      const hasLangCpp = content.includes("lang:cpp");
      if (hasCppRule && !hasLangCpp) problems.push(`${f} missing label lang:cpp`);

      // kind label vocabulary validation (best-effort)
      validateKindLabels(f, kindLabelsOf(labels), problems);
      validatePatchScopeLabels(f, labels, problems);
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
