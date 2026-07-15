import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { pathExists } from "../../lib/repo";
import {
  readVerifiedMarker,
  currentVerifiedMarkerFingerprintCandidates,
} from "../update-pnpm-hash/verified-marker";
import { currentPnpmStoreDerivationIdentity } from "../update-pnpm-hash/build-flake";
import { flakeRefForImporter, pnpmStoreAttr, sanitizeName } from "./common";

export type ImporterInstallFreshness =
  | { fresh: true }
  | {
      fresh: false;
      reason:
        | "force"
        | "missing-lockfile"
        | "missing-hash"
        | "stale-store-marker"
        | "stale-link-marker";
    };

type ImporterFreshnessDeps = {
  currentDerivationIdentity: typeof currentPnpmStoreDerivationIdentity;
};

const defaultDeps: ImporterFreshnessDeps = {
  currentDerivationIdentity: currentPnpmStoreDerivationIdentity,
};

const PLACEHOLDER_HASH = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

function normalizeImporter(input: string): string {
  return input && input !== "." ? input.replace(/\\/g, "/").replace(/\/+$/g, "") : ".";
}

function importerLockRel(importer: string): string {
  return importer === "." ? "pnpm-lock.yaml" : `${importer}/pnpm-lock.yaml`;
}

function hashKeyForImporter(importer: string): string {
  return importer === "viberoots" ? "pnpm-lock.yaml" : importerLockRel(importer);
}

function linkMarkerPath(repoRoot: string, importer: string): string {
  const markerKey = importer === "." ? "root" : sanitizeName(importer);
  return path.join(
    repoRoot,
    ".viberoots",
    "workspace",
    "buck",
    "tmp",
    `node-modules-link.${markerKey}.json`,
  );
}

function importerDir(repoRoot: string, importer: string): string {
  return importer === "." ? repoRoot : path.join(repoRoot, importer);
}

async function sha256File(absPath: string): Promise<string> {
  const buf = await fsp.readFile(absPath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

async function readJsonFile(absPath: string): Promise<Record<string, string>> {
  try {
    return JSON.parse(await fsp.readFile(absPath, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

async function readHashForLockfile(repoRoot: string, lockfileRel: string): Promise<string> {
  const candidates = [
    path.join(repoRoot, "projects", "node-modules.hashes.json"),
    path.join(repoRoot, "build-tools", "tools", "nix", "node-modules.hashes.json"),
    path.join(repoRoot, "viberoots", "build-tools", "tools", "nix", "node-modules.hashes.json"),
    path.join(
      repoRoot,
      ".viberoots",
      "current",
      "build-tools",
      "tools",
      "nix",
      "node-modules.hashes.json",
    ),
  ];
  let hash = "";
  for (const candidate of candidates) {
    const obj = await readJsonFile(candidate);
    hash = String(obj[lockfileRel] || hash || "").trim();
  }
  return hash;
}

async function hasFreshStoreMarker(
  opts: {
    repoRoot: string;
    importer: string;
    lockHash: string;
    hashValue: string;
  },
  deps: ImporterFreshnessDeps,
): Promise<boolean> {
  const markerPath = path.join(
    opts.repoRoot,
    ".viberoots",
    "workspace",
    "buck",
    "tmp",
    `pnpm-store-verified.${opts.importer === "." ? "root" : sanitizeName(opts.importer)}.json`,
  );
  const marker = await readVerifiedMarker(markerPath);
  if (!marker) return false;
  const acceptedFingerprints = await currentVerifiedMarkerFingerprintCandidates(
    opts.repoRoot,
    opts.importer,
  );
  const metadataMatches =
    marker.importer === opts.importer &&
    marker.lockfile === hashKeyForImporter(opts.importer) &&
    marker.lockHash === opts.lockHash &&
    marker.hashValue === opts.hashValue &&
    acceptedFingerprints.includes(marker.builderFingerprint);
  if (!metadataMatches) return false;
  const derivationIdentity = await deps.currentDerivationIdentity({
    repoRoot: opts.repoRoot,
    importer: opts.importer,
    baseFlakeRef: flakeRefForImporter(opts.repoRoot, opts.importer),
    attrPath: pnpmStoreAttr(opts.importer),
  });
  return marker.derivationIdentity === derivationIdentity;
}

async function hasFreshLinkMarker(opts: {
  repoRoot: string;
  importer: string;
  lockHash: string;
}): Promise<boolean> {
  try {
    const marker = JSON.parse(
      await fsp.readFile(linkMarkerPath(opts.repoRoot, opts.importer), "utf8"),
    ) as {
      importer?: string;
      lockfile?: string;
      lockHash?: string;
      outPath?: string;
    };
    const outPath = String(marker.outPath || "").trim();
    const nodeModulesTarget = outPath ? path.join(outPath, "node_modules") : "";
    const importerNodeModules = path.join(
      importerDir(opts.repoRoot, opts.importer),
      "node_modules",
    );
    if (
      marker.importer !== opts.importer ||
      marker.lockfile !== importerLockRel(opts.importer) ||
      marker.lockHash !== opts.lockHash ||
      !nodeModulesTarget ||
      !(await pathExists(nodeModulesTarget))
    ) {
      return false;
    }
    const st = await fsp.lstat(importerNodeModules);
    return st.isSymbolicLink() && (await fsp.readlink(importerNodeModules)) === nodeModulesTarget;
  } catch {
    return false;
  }
}

export async function importerInstallFreshness(
  opts: {
    repoRoot: string;
    importer: string;
    force?: boolean;
  },
  deps: ImporterFreshnessDeps = defaultDeps,
): Promise<ImporterInstallFreshness> {
  if (opts.force) return { fresh: false, reason: "force" };
  const importer = normalizeImporter(opts.importer);
  const lockRel = importerLockRel(importer);
  const lockAbs = path.join(opts.repoRoot, lockRel);
  let lockHash = "";
  try {
    lockHash = await sha256File(lockAbs);
  } catch {
    return { fresh: false, reason: "missing-lockfile" };
  }
  const hashValue = await readHashForLockfile(opts.repoRoot, hashKeyForImporter(importer));
  if (!hashValue || hashValue === PLACEHOLDER_HASH) {
    return { fresh: false, reason: "missing-hash" };
  }
  if (
    !(await hasFreshStoreMarker(
      {
        repoRoot: opts.repoRoot,
        importer,
        lockHash,
        hashValue,
      },
      deps,
    ))
  ) {
    return { fresh: false, reason: "stale-store-marker" };
  }
  if (!(await hasFreshLinkMarker({ repoRoot: opts.repoRoot, importer, lockHash }))) {
    return { fresh: false, reason: "stale-link-marker" };
  }
  return { fresh: true };
}
