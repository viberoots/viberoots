#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { getFlagStr } from "../lib/cli";
import {
  hasExceptionPolicySection,
  macroNamePattern,
  missingLegendTerms,
  nodeDefsBzlPath,
  parseArtifactRouteGaps,
  parseInventoryNixRouteDetails,
  parseNixGapsInventory,
  parseNodeClassificationTableMacros,
  parseNonBuildInventoryMacros,
  publicNodeDefsBzlPath,
  parseStarlarkIndexMacros,
  parseStarlarkIndexMacrosByModule,
  type ArtifactRouteAllowlistEntry,
  type NixGapsException,
} from "./nix-gaps-inventory-check-lib";
import { enforceNodeImplementationRouteChecks } from "./nix-gaps-inventory-node-routes";

const defaultExceptionsPath = "docs/handbook/nix-gaps-exceptions.json";

async function sourceRoot(): Promise<string> {
  const envRoot = String(
    process.env.VIBEROOTS_SOURCE_ROOT || process.env.VIBEROOTS_ROOT || "",
  ).trim();
  if (envRoot) return envRoot;
  if (await fs.pathExists(path.join("viberoots", "build-tools"))) return path.resolve("viberoots");
  return process.cwd();
}

async function sourceOwnedPath(source: string, relOrAbs: string): Promise<string> {
  if (path.isAbsolute(relOrAbs)) return relOrAbs;
  if (await fs.pathExists(relOrAbs)) return relOrAbs;
  return path.join(source, relOrAbs);
}

async function main() {
  const source = await sourceRoot();
  const starlarkPath = await sourceOwnedPath(
    source,
    getFlagStr("starlark-api", "docs/handbook/starlark-api.md"),
  );
  const inventoryPath = await sourceOwnedPath(
    source,
    getFlagStr("nix-gaps", "docs/handbook/nix-gaps.md"),
  );
  const exceptionsPath = await sourceOwnedPath(
    source,
    getFlagStr("exceptions", defaultExceptionsPath),
  );

  const starlarkTxt = await fs.readFile(starlarkPath, "utf8");
  const inventoryTxt = await fs.readFile(inventoryPath, "utf8");
  const exceptionsJson = await fs.readJson(exceptionsPath);
  const exceptionListRaw = Array.isArray(exceptionsJson?.exceptions)
    ? exceptionsJson.exceptions
    : [];
  const exceptionList = exceptionListRaw as NixGapsException[];
  const artifactRouteAllowlistRaw = Array.isArray(exceptionsJson?.artifactRouteAllowlist)
    ? exceptionsJson.artifactRouteAllowlist
    : [];
  const artifactRouteAllowlist = artifactRouteAllowlistRaw as ArtifactRouteAllowlistEntry[];

  const starlarkMacros = parseStarlarkIndexMacros(starlarkTxt);
  const starlarkByModule = parseStarlarkIndexMacrosByModule(starlarkTxt);
  const nodePublicMacros =
    starlarkByModule[publicNodeDefsBzlPath] || starlarkByModule[nodeDefsBzlPath] || [];
  const inventoryMacros = parseNixGapsInventory(inventoryTxt);
  const nodeClassificationMacros = parseNodeClassificationTableMacros(inventoryTxt);
  const nonBuildInventoryMacros = parseNonBuildInventoryMacros(inventoryTxt);
  const artifactRouteGaps = parseArtifactRouteGaps(inventoryTxt);
  const nixRouteDetailsByMacro = parseInventoryNixRouteDetails(inventoryTxt);
  const hasNodeImplementationFiles =
    (await fs.pathExists(path.join(source, "build-tools", "node", "defs_core.bzl"))) &&
    (await fs.pathExists(path.join(source, "build-tools", "node", "defs_stage.bzl")));

  const malformedExceptionEntries = exceptionList.filter(
    (e) =>
      !macroNamePattern.test(String(e?.macro || "").trim()) ||
      String(e?.kind || "").trim() !== "probe-only" ||
      String(e?.justification || "").trim() === "",
  );
  if (malformedExceptionEntries.length > 0) {
    console.error(
      `Malformed exception entries in ${exceptionsPath}; each entry needs macro, kind="probe-only", and non-empty justification.`,
    );
    process.exit(1);
  }
  const malformedArtifactRouteAllowlist = artifactRouteAllowlist.filter(
    (e) =>
      !macroNamePattern.test(String(e?.macro || "").trim()) ||
      !["buck-build", "stub-artifact-expected", "mixed"].includes(String(e?.kind || "").trim()) ||
      String(e?.justification || "").trim() === "",
  );
  if (malformedArtifactRouteAllowlist.length > 0) {
    console.error(
      `Malformed artifactRouteAllowlist entries in ${exceptionsPath}; each entry needs macro, kind in {"buck-build","stub-artifact-expected","mixed"}, and non-empty justification.`,
    );
    process.exit(1);
  }

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
      `No Node public macros parsed from ${starlarkPath} (${publicNodeDefsBzlPath} in Index).`,
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
  const nonBuildInventorySet = new Set(nonBuildInventoryMacros.map((v) => v.macro));
  const exceptionSet = new Set(exceptionList.map((v) => v.macro));

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
  const disallowedStubGaps = nonBuildInventoryMacros.filter(
    (v) => v.kind === "stub-artifact-expected",
  );
  const missingExceptionEntries = [...nonBuildInventorySet].filter((m) => !exceptionSet.has(m));
  const routeGapKeys = new Set(artifactRouteGaps.map((v) => `${v.macro}:${v.kind}`));
  const allowlistKeys = new Set(artifactRouteAllowlist.map((v) => `${v.macro}:${v.kind}`));
  const missingArtifactRouteAllowlist = artifactRouteGaps.filter(
    (v) => !allowlistKeys.has(`${v.macro}:${v.kind}`),
  );
  const staleArtifactRouteAllowlist = artifactRouteAllowlist.filter(
    (v) => !routeGapKeys.has(`${v.macro}:${v.kind}`),
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
  if (disallowedStubGaps.length > 0) {
    console.error("Stub (artifact expected) entries are not allowed under exception policy:");
    for (const gap of disallowedStubGaps) console.error(`- ${gap.macro}`);
    process.exit(1);
  }
  if (missingExceptionEntries.length > 0) {
    console.error("Missing exception policy entries for non-build macros:");
    for (const macro of missingExceptionEntries) console.error(`- ${macro}`);
    process.exit(1);
  }
  if (missingArtifactRouteAllowlist.length > 0) {
    console.error("Missing artifact route allowlist entries for non-Nix artifact routes:");
    for (const item of missingArtifactRouteAllowlist) console.error(`- ${item.macro}:${item.kind}`);
    process.exit(1);
  }
  if (staleArtifactRouteAllowlist.length > 0) {
    console.error("Stale artifactRouteAllowlist entries (no matching current route gap):");
    for (const item of staleArtifactRouteAllowlist) console.error(`- ${item.macro}:${item.kind}`);
    process.exit(1);
  }

  await enforceNodeImplementationRouteChecks({
    hasNodeImplementationFiles,
    nixRouteDetailsByMacro,
  });

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
