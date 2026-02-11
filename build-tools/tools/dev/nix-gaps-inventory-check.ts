#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import { getFlagStr } from "../lib/cli";
import {
  type ArtifactRouteAllowlistEntry,
  hasExceptionPolicySection,
  macroNamePattern,
  missingLegendTerms,
  nodeDefsBzlPath,
  parseArtifactRouteGaps,
  parseNixGapsInventory,
  parseNodeClassificationTableMacros,
  parseNonBuildInventoryMacros,
  parseStarlarkIndexMacros,
  parseStarlarkIndexMacrosByModule,
  type NixGapsException,
} from "./nix-gaps-inventory-check-lib.ts";

const defaultExceptionsPath = "docs/handbook/nix-gaps-exceptions.json";

async function main() {
  const starlarkPath = getFlagStr("starlark-api", "docs/handbook/starlark-api.md");
  const inventoryPath = getFlagStr("nix-gaps", "docs/handbook/nix-gaps.md");
  const exceptionsPath = getFlagStr("exceptions", defaultExceptionsPath);

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
  const nodePublicMacros = starlarkByModule[nodeDefsBzlPath] || [];
  const inventoryMacros = parseNixGapsInventory(inventoryTxt);
  const nodeClassificationMacros = parseNodeClassificationTableMacros(inventoryTxt);
  const nonBuildInventoryMacros = parseNonBuildInventoryMacros(inventoryTxt);
  const artifactRouteGaps = parseArtifactRouteGaps(inventoryTxt);
  const hasNodeImplementationFiles =
    (await fs.pathExists("build-tools/node/defs_core.bzl")) &&
    (await fs.pathExists("build-tools/node/defs_stage.bzl"));

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

  if (hasNodeImplementationFiles) {
    const nodeDefsCoreTxt = await fs.readFile("build-tools/node/defs_core.bzl", "utf8");
    const nodeDefsStageTxt = await fs.readFile("build-tools/node/defs_stage.bzl", "utf8");
    const routeLine = (macro: string) => new RegExp(`^- \`${macro}\`\\s+→\\s+Nix build`, "m");
    const nodeMacrosClaimedNix = [
      "nix_node_gen",
      "nix_node_lib",
      "nix_node_bin",
      "node_asset_stage",
      "node_wasm_inline_module",
    ].filter((macro) => routeLine(macro).test(inventoryTxt));

    if (nodeMacrosClaimedNix.length > 0) {
      const missingRouteSignals: string[] = [];
      if (!nodeDefsCoreTxt.includes('planner_name = name + "__planner"')) {
        missingRouteSignals.push("defs_core missing planner companion target for nix_node_gen");
      }
      if (!nodeDefsCoreTxt.includes('wiring = "nix_calling_genrule"')) {
        missingRouteSignals.push(
          "defs_core missing nix_calling_genrule wiring for public nix_node_gen",
        );
      }
      if (!nodeDefsCoreTxt.includes("graph-generator-selected")) {
        missingRouteSignals.push(
          "defs_core missing graph-generator-selected route for nix_node_gen",
        );
      }
      if (!nodeDefsStageTxt.includes("graph-generator-selected")) {
        missingRouteSignals.push(
          "defs_stage missing graph-generator-selected Nix route for stage/inline macros",
        );
      }
      if (missingRouteSignals.length > 0) {
        console.error(
          `Node implementation route checks failed for Nix-claimed macros: ${nodeMacrosClaimedNix.join(", ")}`,
        );
        for (const msg of missingRouteSignals) console.error(`- ${msg}`);
        process.exit(1);
      }
    }
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
