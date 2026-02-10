#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import { getFlagStr } from "../lib/cli";

const macroNamePattern = /^[a-z][a-z0-9_]+$/;
const nodeDefsBzlPath = "//build-tools/node:defs.bzl";
const requiredLegendTerms = ["Buck build", "Stub (artifact expected)", "Probe-only exception"];

function uniqStable(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function parseStarlarkIndexMacros(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const macros: string[] = [];
  let inIndex = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("## ")) {
      if (line === "## Index") {
        inIndex = true;
        continue;
      }
      if (inIndex) break;
    }
    if (!inIndex) continue;
    const match = line.match(/`([^`]+)`/);
    if (!match) continue;
    const value = match[1].trim();
    if (!macroNamePattern.test(value)) continue;
    macros.push(value);
  }
  return uniqStable(macros);
}

function parseStarlarkIndexMacrosByModule(text: string): Record<string, string[]> {
  const lines = text.split(/\r?\n/);
  const byModule: Record<string, string[]> = {};
  let inIndex = false;
  let currentModule = "";
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("## ")) {
      if (line === "## Index") {
        inIndex = true;
        continue;
      }
      if (inIndex) break;
    }
    if (!inIndex) continue;
    const moduleMatch = line.match(/^- `([^`]+)`$/);
    const moduleValue = moduleMatch ? moduleMatch[1].trim() : "";
    const isModulePath =
      moduleValue.startsWith("//") && moduleValue.includes(":") && moduleValue.endsWith(".bzl");
    if (moduleMatch && isModulePath) {
      currentModule = moduleValue;
      if (!byModule[currentModule]) byModule[currentModule] = [];
      continue;
    }
    const macroMatch = line.match(/^- `([^`]+)`/);
    if (!macroMatch || !currentModule) continue;
    const macro = macroMatch[1].trim();
    if (!macroNamePattern.test(macro)) continue;
    byModule[currentModule].push(macro);
  }
  for (const mod of Object.keys(byModule)) byModule[mod] = uniqStable(byModule[mod]);
  return byModule;
}

function parseNixGapsInventory(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const macros: string[] = [];
  for (const raw of lines) {
    const match = raw.match(/^- `([^`]+)`/);
    if (!match) continue;
    const value = match[1].trim();
    if (!macroNamePattern.test(value)) continue;
    macros.push(value);
  }
  return uniqStable(macros);
}

function sectionLines(text: string, heading: string): string[] {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let inSection = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim() === heading) {
      inSection = true;
      continue;
    }
    if (!inSection) continue;
    if (line.startsWith("## ")) break;
    out.push(raw);
  }
  return out;
}

function parseNodeClassificationTableMacros(text: string): string[] {
  const lines = sectionLines(text, "## Node macros");
  if (lines.length === 0) return [];
  const macros: string[] = [];
  let inTable = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!inTable && line === "Node macro outcome classification:") {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    if (line === "") {
      if (macros.length > 0) break;
      continue;
    }
    if (!line.startsWith("|")) continue;
    if (/^\|\s*-+\s*\|/.test(line)) continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((v) => v.trim());
    if (cells.length === 0) continue;
    const first = cells[0].replaceAll("`", "").trim();
    if (!macroNamePattern.test(first)) continue;
    macros.push(first);
  }
  return uniqStable(macros);
}

function hasExceptionPolicySection(text: string): boolean {
  return sectionLines(text, "## Exception policy (intentional non-build macros)").length > 0;
}

function missingLegendTerms(text: string): string[] {
  return requiredLegendTerms.filter((term) => !text.includes(term));
}

async function main() {
  const starlarkPath = getFlagStr("starlark-api", "docs/handbook/starlark-api.md");
  const inventoryPath = getFlagStr("nix-gaps", "docs/handbook/nix-gaps.md");

  const starlarkTxt = await fs.readFile(starlarkPath, "utf8");
  const inventoryTxt = await fs.readFile(inventoryPath, "utf8");

  const starlarkMacros = parseStarlarkIndexMacros(starlarkTxt);
  const starlarkByModule = parseStarlarkIndexMacrosByModule(starlarkTxt);
  const nodePublicMacros = starlarkByModule[nodeDefsBzlPath] || [];
  const inventoryMacros = parseNixGapsInventory(inventoryTxt);
  const nodeClassificationMacros = parseNodeClassificationTableMacros(inventoryTxt);

  if (starlarkMacros.length === 0) {
    console.error(`No macros parsed from ${starlarkPath} (Index section).`);
    process.exit(1);
  }
  if (inventoryMacros.length === 0) {
    console.error(`No macros parsed from ${inventoryPath}.`);
    process.exit(1);
  }
  if (nodePublicMacros.length === 0) {
    console.error(
      `No Node public macros parsed from ${starlarkPath} (${nodeDefsBzlPath} in Index).`,
    );
    process.exit(1);
  }
  if (nodeClassificationMacros.length === 0) {
    console.error(`No Node classification table entries parsed from ${inventoryPath}.`);
    process.exit(1);
  }
  if (!hasExceptionPolicySection(inventoryTxt)) {
    console.error(
      `Missing section in ${inventoryPath}: "## Exception policy (intentional non-build macros)".`,
    );
    process.exit(1);
  }
  const missingLegend = missingLegendTerms(inventoryTxt);
  if (missingLegend.length > 0) {
    console.error(`Legend is missing required framing term(s): ${missingLegend.join(", ")}`);
    process.exit(1);
  }

  const inventorySet = new Set(inventoryMacros);
  const starlarkSet = new Set(starlarkMacros);
  const nodeClassifiedSet = new Set(nodeClassificationMacros);

  const missing = starlarkMacros.filter((m) => !inventorySet.has(m));
  const extra = inventoryMacros.filter((m) => !starlarkSet.has(m));

  if (missing.length > 0) {
    console.error("Missing macros in nix-gaps inventory:");
    for (const name of missing) console.error(`- ${name}`);
    process.exit(1);
  }

  const missingNodeClassifications = nodePublicMacros.filter((m) => !nodeClassifiedSet.has(m));
  const extraNodeClassifications = nodeClassificationMacros.filter(
    (m) => !nodePublicMacros.includes(m),
  );
  if (missingNodeClassifications.length > 0) {
    console.error("Missing Node classification entries in nix-gaps Node classification table:");
    for (const name of missingNodeClassifications) console.error(`- ${name}`);
    process.exit(1);
  }
  if (extraNodeClassifications.length > 0) {
    console.error(
      "Extra Node classification entries not present in Starlark Node public macro list:",
    );
    for (const name of extraNodeClassifications) console.error(`- ${name}`);
    process.exit(1);
  }

  if (extra.length > 0) {
    console.warn("Extra macros in nix-gaps inventory (not in starlark index):");
    for (const name of extra) console.warn(`- ${name}`);
  }

  console.log(
    `nix-gaps inventory OK (${starlarkMacros.length} public macros, ${inventoryMacros.length} inventory entries, ${nodePublicMacros.length} Node classifications)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
