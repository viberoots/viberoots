#!/usr/bin/env zx-wrapper
import fs from "node:fs";
import path from "node:path";
import { sanitizeName } from "./install/common.ts";
import { withExclusiveInstallLock } from "./install/lock.ts";
import { parseUpdatePnpmHashArgs } from "./update-pnpm-hash/args.ts";
import { updateNodeModulesHashesJson } from "./update-pnpm-hash/hashes-json.ts";
import { generateImporterLockfile } from "./update-pnpm-hash/lockfile.ts";
import { importerLockfileNeedsRegen } from "../lib/pnpm-importer-lockfile.ts";
import {
  buildStore,
  buildUnfixedAndHash,
  extractHash,
  flakeAttrExists,
} from "./update-pnpm-hash/nix.ts";
import {
  importerFromLockfile,
  normalizeImporter,
  pnpmStoreAttrFromImporter,
  pnpmStoreUnfixedAttrFromImporter,
  repoRelativeLockfilePath,
} from "./update-pnpm-hash/paths.ts";

async function inner() {
  const { lockfile, force } = parseUpdatePnpmHashArgs();
  const repoRoot = process.cwd();
  const relLock = repoRelativeLockfilePath(repoRoot, lockfile);
  const importer = importerFromLockfile(relLock);
  const storeAttr = pnpmStoreAttrFromImporter(importer);
  const unfixedAttr = pnpmStoreUnfixedAttrFromImporter(importer);
  // quiet: avoid noisy diagnostics in normal operation
  const normImp = normalizeImporter(importer);
  const isDefault = !normImp || normImp === ".";
  const sanitized = isDefault ? "default" : sanitizeName(normImp);
  if (!isDefault) {
    const hasUnfixed = await flakeAttrExists("pnpm-store-unfixed", sanitized);
    if (!hasUnfixed) {
      return;
    }
  }

  // If forcing, pre-write placeholder digest to bump the FOD derivation and force a rebuild
  if (force) {
    const key = importer && importer !== "." ? `${importer}/pnpm-lock.yaml` : "pnpm-lock.yaml";
    // Known placeholder value also used in node-modules.nix
    const placeholder = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    await updateNodeModulesHashesJson(key, placeholder);
  }

  // If importer lockfile is missing and generation is allowed, generate it OUTSIDE Nix first
  const impAbsGen = path.resolve(repoRoot, importer);
  const impLockGen = path.join(impAbsGen, "pnpm-lock.yaml");
  const allowGenerate = String(process.env.NIX_PNPM_ALLOW_GENERATE || "").trim() === "1";
  if (allowGenerate) {
    const missing = !fs.existsSync(impLockGen);
    const stale = !missing
      ? await importerLockfileNeedsRegen({ repoRootAbs: repoRoot, importerRel: importer }).catch(
          () => true,
        )
      : true;
    if (missing || stale) {
      await generateImporterLockfile({ repoRoot, importer });
    }
  }

  // Robust path: build unfixed store and compute SRI from its normalized 'store' directory
  const key = importer && importer !== "." ? `${importer}/pnpm-lock.yaml` : "pnpm-lock.yaml";
  let pre = await buildUnfixedAndHash(unfixedAttr);
  // If the flake does not expose a per-importer attr for this importer, skip gracefully.
  if (!pre.ok && /does not provide attribute/.test(String(pre.output || ""))) {
    console.warn(
      `[update-pnpm-hash] skip: flake attr missing (${unfixedAttr}); continuing without per-importer store prewarm`,
    );
    return;
  }
  if (!pre.ok) {
    // Attempt to regenerate lock in importer (isolated workspace root), then retry once
    await generateImporterLockfile({ repoRoot, importer });
    pre = await buildUnfixedAndHash(unfixedAttr);
    if (!pre.ok && /does not provide attribute/.test(String(pre.output || ""))) {
      console.warn(
        `[update-pnpm-hash] skip after regen: flake attr still missing (${unfixedAttr})`,
      );
      return;
    }
    // If still failing or missing SRI, pre-seed a placeholder to force a suggestion on verify
    if (!pre.ok || !pre.sri) {
      const key = importer && importer !== "." ? `${importer}/pnpm-lock.yaml` : "pnpm-lock.yaml";
      const placeholder = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
      await updateNodeModulesHashesJson(key, placeholder);
    }
  }
  if (pre.ok && pre.sri) {
    await updateNodeModulesHashesJson(key, pre.sri);
  }

  // Verify fixed-output build; if it still fails, fall back once to parsing suggestion
  const verify = await buildStore(storeAttr);
  if (!verify.ok) {
    if (/does not provide attribute/.test(String(verify.output || ""))) {
      console.warn(`[update-pnpm-hash] skip: flake attr missing (${storeAttr}); continuing`);
      return;
    }
    let suggested = extractHash(verify.output || "");
    if (!suggested && pre && pre.sri) {
      suggested = pre.sri;
    }
    if (!suggested) {
      const retry = await buildUnfixedAndHash(unfixedAttr);
      if (retry.ok && retry.sri) suggested = retry.sri;
    }
    if (!suggested) {
      console.error(
        "pnpm-store still failing and no suggested hash found\n\n" + (verify.output || ""),
      );
      process.exit(1);
    }
    await updateNodeModulesHashesJson(key, suggested);
    const final = await buildStore(storeAttr);
    if (!final.ok) {
      console.error("pnpm-store still failing after hash update\n\n" + final.output);
      process.exit(1);
    }
  }
  console.log("pnpm-store:", storeAttr, "hash updated and build succeeded");
}

async function main() {
  if (String(process.env.INSTALL_LOCK_SKIP || "").trim() === "1") {
    await inner();
    return;
  }
  await withExclusiveInstallLock("node-modules", inner, {
    verbose: String(process.env.INSTALL_LOCK_VERBOSE || "").trim() === "1",
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
