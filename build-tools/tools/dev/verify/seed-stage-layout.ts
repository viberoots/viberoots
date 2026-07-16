import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

export const PREPARED_MARKER = ".seed-store-prepared-v7";
export const STAGE_ROOT_PROTOCOL_DIR = "stage-v8";

export function seedStageRootDirForTest(): string {
  const override = String(process.env.VBR_VERIFY_SEED_STAGE_ROOT || "").trim();
  if (override) return path.resolve(override);
  if (process.platform === "win32") return path.join(os.tmpdir(), "viberoots-test-seed");
  let user = "";
  try {
    user = os.userInfo().username || "";
  } catch {}
  const suffix = user ? `-${user}` : "";
  const name = `viberoots-test-seed${suffix}`;
  const base =
    process.platform === "darwin" ? path.join("/tmp", `${name}.noindex`) : path.join("/tmp", name);
  return path.join(base, STAGE_ROOT_PROTOCOL_DIR);
}

export function seedStageRootDir(): string {
  return seedStageRootDirForTest();
}

export async function canonicalSeedStageRoot(): Promise<string> {
  const root = seedStageRootDir();
  return await fsp.realpath(root).catch(() => path.resolve(root));
}

function seedStageKey(seedKey: string): string {
  return crypto.createHash("sha256").update(seedKey).digest("hex").slice(0, 12);
}

export function seedStageDir(seedKey: string): string {
  return path.join(seedStageRootDir(), `seed-${seedStageKey(seedKey)}`);
}

export function seedStageLockDir(seedKey: string): string {
  return path.join(seedStageRootDir(), `lock-${seedStageKey(seedKey)}`);
}

async function statDev(pathToStat: string): Promise<number | null> {
  try {
    const st = await fsp.stat(pathToStat);
    return typeof st.dev === "number" ? st.dev : null;
  } catch {
    return null;
  }
}

export async function shouldStageSeed(seedPath: string): Promise<boolean> {
  const seedDev = await statDev(seedPath);
  const tmpDev = await statDev(os.tmpdir());
  if (seedDev === null || tmpDev === null) return false;
  return seedDev !== tmpDev;
}
