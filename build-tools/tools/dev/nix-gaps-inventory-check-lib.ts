export const macroNamePattern = /^[a-z][a-z0-9_]+$/;
export const nodeDefsBzlPath = "//build-tools/node:defs.bzl";
export const publicNodeDefsBzlPath = "@viberoots//build-tools/node:defs.bzl";
export const requiredLegendTerms = [
  "Buck build",
  "Stub (artifact expected)",
  "Probe-only exception",
];

export type NonBuildKind = "probe-only" | "stub-artifact-expected";
export type ArtifactRouteGapKind = "buck-build" | "stub-artifact-expected" | "mixed";

export type NixGapsException = {
  macro: string;
  kind: NonBuildKind;
  justification: string;
};

export type ArtifactRouteAllowlistEntry = {
  macro: string;
  kind: ArtifactRouteGapKind;
  justification: string;
};

export type ArtifactRouteGap = {
  macro: string;
  kind: ArtifactRouteGapKind;
};

export function uniqStable(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

export function parseStarlarkIndexMacros(text: string): string[] {
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

export function parseStarlarkIndexMacrosByModule(text: string): Record<string, string[]> {
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
      (moduleValue.startsWith("//") || moduleValue.startsWith("@viberoots//")) &&
      moduleValue.includes(":") &&
      moduleValue.endsWith(".bzl");
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

export function parseNixGapsInventory(text: string): string[] {
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

export function parseNodeClassificationTableMacros(text: string): string[] {
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
    if (!line.startsWith("|") || /^\|\s*-+\s*\|/.test(line)) continue;
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

export function hasExceptionPolicySection(text: string): boolean {
  return sectionLines(text, "## Exception policy (intentional non-build macros)").length > 0;
}

export function missingLegendTerms(text: string): string[] {
  return requiredLegendTerms.filter((term) => !text.includes(term));
}

export function parseNonBuildInventoryMacros(text: string): NixGapsException[] {
  const entries: NixGapsException[] = [];
  const regex = /^- `([^`]+)`\s+→\s+(Probe-only exception|Stub \(artifact expected\))/gm;
  for (const match of text.matchAll(regex)) {
    const macro = String(match[1] || "").trim();
    if (!macroNamePattern.test(macro)) continue;
    const kind: NonBuildKind =
      String(match[2] || "").trim() === "Probe-only exception"
        ? "probe-only"
        : "stub-artifact-expected";
    entries.push({ macro, kind, justification: "inventory" });
  }
  return entries;
}

export function parseArtifactRouteGaps(text: string): ArtifactRouteGap[] {
  const entries: ArtifactRouteGap[] = [];
  const regex = /^- `([^`]+)`\s+→\s+(Buck build|Stub \(artifact expected\)|Mixed)(?::|\s|\(|$)/gm;
  for (const match of text.matchAll(regex)) {
    const macro = String(match[1] || "").trim();
    if (!macroNamePattern.test(macro)) continue;
    const route = String(match[2] || "").trim();
    let kind: ArtifactRouteGapKind = "buck-build";
    if (route === "Stub (artifact expected)") kind = "stub-artifact-expected";
    if (route === "Mixed") kind = "mixed";
    entries.push({ macro, kind });
  }
  return entries;
}

export function parseInventoryNixRouteDetails(text: string): Record<string, string> {
  const byMacro: Record<string, string> = {};
  const regex = /^- `([^`]+)`\s+→\s+Nix build\s+\(([^)]+)\)\.?$/gm;
  for (const match of text.matchAll(regex)) {
    const macro = String(match[1] || "").trim();
    const detail = String(match[2] || "").trim();
    if (!macroNamePattern.test(macro) || detail === "") continue;
    byMacro[macro] = detail;
  }
  return byMacro;
}

export function bzlDefBody(text: string, macroName: string): string {
  const needle = `def ${macroName}(`;
  const start = text.indexOf(needle);
  if (start < 0) return "";
  const next = text.indexOf("\ndef ", start + needle.length);
  if (next < 0) return text.slice(start);
  return text.slice(start, next);
}
