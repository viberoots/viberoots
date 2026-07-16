import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { writeIfChanged } from "../../lib/fs-helpers";
import { mkdirWithMacosMetadataExclusion } from "../../lib/macos-metadata";
import { createSharedSeedStagePin, stageSeedStore } from "./seed-staging";

function seedRootDir(root: string): string {
  return path.join(root, ".viberoots", "workspace", "buck", "verify-seed");
}

export async function writeCurrentSeed(
  root: string,
  seedPath: string,
  seedKey: string,
): Promise<void> {
  const dir = seedRootDir(root);
  await mkdirWithMacosMetadataExclusion(dir).catch(() => {});
  await writeIfChanged(path.join(dir, "current"), seedPath + "\n");
  await writeIfChanged(path.join(dir, "current.key"), seedKey + "\n");
}

export async function readCurrentSeed(root: string, seedKey: string): Promise<string | null> {
  const dir = seedRootDir(root);
  const existingKey = (
    await fsp.readFile(path.join(dir, "current.key"), "utf8").catch(() => "")
  ).trim();
  if (existingKey !== seedKey) return null;
  const seedPath = (await fsp.readFile(path.join(dir, "current"), "utf8").catch(() => "")).trim();
  if (!seedPath) return null;
  return await fsp
    .access(seedPath)
    .then(() => seedPath)
    .catch(() => null);
}

export async function createVerifySeedPin(
  root: string,
  iso: string,
  seedPath: string,
  seedKey: string,
): Promise<string> {
  const pinDir = path.join(seedRootDir(root), "pins", iso);
  await mkdirWithMacosMetadataExclusion(pinDir).catch(() => {});
  await fsp.writeFile(
    path.join(pinDir, "owner.json"),
    JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), seedKey }) + "\n",
    "utf8",
  );
  const link = path.join(pinDir, "seed");
  await fsp.rm(link, { recursive: true, force: true }).catch(() => {});
  await fsp.symlink(seedPath, link).catch(() => {});
  return pinDir;
}

type StageDeps = {
  createSharedPin: typeof createSharedSeedStagePin;
  stage: typeof stageSeedStore;
  remove: (path: string) => Promise<void>;
};

export async function stageSeedWithInheritedProtection(
  opts: {
    seedPath: string;
    seedKey: string;
    seedTtlMs: number;
    workspaceRoot: string;
    iso: string;
    inheritedPinDir?: string;
  },
  deps: StageDeps = {
    createSharedPin: createSharedSeedStagePin,
    stage: stageSeedStore,
    remove: async (target) => await fsp.rm(target, { recursive: true, force: true }),
  },
): Promise<string> {
  let inheritedSharedPin: string | null = null;
  if (opts.inheritedPinDir) {
    const link = path.join(opts.inheritedPinDir, "seed");
    const target = await fsp.readlink(link).catch(() => "");
    if (target) {
      inheritedSharedPin = await deps.createSharedPin(
        path.resolve(opts.inheritedPinDir, target),
        `${opts.iso}-inherited`,
      );
    }
  }
  try {
    return await deps.stage(opts.seedPath, opts.seedKey, opts.seedTtlMs, {
      workspaceRoot: opts.workspaceRoot,
      sharedPinIso: opts.iso,
    });
  } finally {
    if (inheritedSharedPin) await deps.remove(inheritedSharedPin);
  }
}
