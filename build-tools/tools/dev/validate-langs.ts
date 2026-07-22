#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { createRequire } from "node:module";
import {
  hasReproducibilityMatrixId,
  reproducibilityMatrixCaseCoversLanguage,
  reproducibilityMatrixCoverage,
} from "../lib/artifact-reproducibility-matrix";

const require = createRequire(import.meta.url);
// Lazy load ajv so the script remains fast if not installed; provide a friendly hint.
let Ajv: any;
try {
  Ajv = require("ajv");
} catch {
  console.error(
    "Missing dependency: ajv. Install it or run via dev shell to validate build-tools/tools/nix/langs.json",
  );
  process.exit(2);
}

type ManifestLike = any;

async function sourceRoot(repo: string): Promise<string> {
  const envRoot = String(
    process.env.VIBEROOTS_SOURCE_ROOT || process.env.VIBEROOTS_ROOT || "",
  ).trim();
  if (envRoot) return path.resolve(envRoot);
  if (await fs.pathExists(path.join(repo, "viberoots", "build-tools"))) {
    return path.join(repo, "viberoots");
  }
  return repo;
}

async function main(): Promise<void> {
  const repo = process.cwd();
  const source = await sourceRoot(repo);
  const manifestPath = path.join(source, "build-tools/tools/nix/langs.json");
  const schemaPath = path.join(source, "build-tools/tools/dev/langs.schema.json");
  const exists = await fs.pathExists(manifestPath);
  if (!exists) {
    console.log("langs.json not found — OK (nothing to validate)");
    return;
  }
  const [raw, schemaText] = await Promise.all([
    fs.readFile(manifestPath, "utf8"),
    fs.readFile(schemaPath, "utf8"),
  ]);
  let doc: ManifestLike;
  try {
    doc = JSON.parse(raw);
  } catch (e) {
    console.error("Invalid JSON in build-tools/tools/nix/langs.json:", e);
    process.exit(1);
  }
  let schema: any;
  try {
    schema = JSON.parse(schemaText);
  } catch (e) {
    console.error("Invalid JSON Schema in build-tools/tools/dev/langs.schema.json:", e);
    process.exit(1);
  }
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  const ok = validate(doc);
  if (!ok) {
    console.error("langs.json validation failed:\n");
    for (const err of validate.errors || []) {
      console.error(`- ${err.instancePath || "."} ${err.message}`);
    }
    process.exit(1);
  }
  const enabled = new Set<string>(Array.isArray(doc) ? [] : (doc.enabled || []).map(String));
  const languages = Array.isArray(doc) ? doc : doc.languages || [];
  const byId = new Map(languages.map((language: any) => [String(language.id), language]));
  for (const id of enabled) {
    const language: any = byId.get(id);
    if (!language) {
      console.error(`langs.json validation failed: enabled language ${id} has no manifest entry`);
      process.exit(1);
    }
    const hermetic = language.hermetic;
    const booleanGates = [
      "sourceRoles",
      "dependencyReconciliation",
      "immutableBundleInputs",
      "storeQualifiedToolchain",
      "selectorTransport",
      "sandboxNetwork",
      "remoteExecution",
      "publicationAdmission",
    ];
    const gaps = booleanGates.filter((key) => hermetic[key] !== true);
    if (hermetic.status !== "graduated") gaps.unshift("status");
    if (hermetic.reproducibilityMatrixIds.length === 0) gaps.push("reproducibilityMatrixIds");
    for (const matrixId of hermetic.reproducibilityMatrixIds) {
      if (!hasReproducibilityMatrixId(String(matrixId))) {
        gaps.push(`unknown reproducibilityMatrixId ${String(matrixId)}`);
      } else if (!reproducibilityMatrixCaseCoversLanguage(String(matrixId), id)) {
        gaps.push(`reproducibilityMatrixId ${String(matrixId)} does not cover language ${id}`);
      }
    }
    const knownMatrixIds = hermetic.reproducibilityMatrixIds
      .map(String)
      .filter(hasReproducibilityMatrixId);
    const coveredRoutes = reproducibilityMatrixCoverage(knownMatrixIds, id);
    const requiredRoutes = new Set<string>(["base"]);
    for (const kind of language.kinds.map(String)) {
      if (["wasm", "mixed", "addon"].includes(kind)) requiredRoutes.add(kind);
    }
    for (const route of requiredRoutes) {
      if (!coveredRoutes.has(route as "base")) {
        gaps.push(`reproducibility matrix does not cover ${route} route for language ${id}`);
      }
    }
    if (gaps.length > 0) {
      console.error(
        `langs.json validation failed: enabled language ${id} is not graduated: ${gaps.join(", ")}`,
      );
      process.exit(1);
    }
  }
  console.log("langs.json: OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
