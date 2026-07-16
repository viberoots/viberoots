import * as fsp from "node:fs/promises";

export const PREPARED_SEED_MARKER = ".seed-store-prepared-v7";

export type SeedStoreConfiguration =
  | { mode: "rsync"; seedKey: ""; seedPath: "" }
  | { mode: "seed-store"; seedKey: string; seedPath: string };

function isVerifyMode(): boolean {
  return Boolean(process.env.VBR_VERIFY_LOCK_DIR || process.env.VBR_VERIFY_LOG_FILE);
}

export function wantsFilteredRsync(): boolean {
  return (
    String(process.env.TEST_RSYNC_ROOTS || "").trim() !== "" ||
    String(process.env.TEST_PARTIAL_CLONE_GO_ONLY || "").trim() === "1"
  );
}

export async function requireSeedPath(seedPath: string, seedKey: string): Promise<void> {
  const st = await fsp.stat(seedPath).catch(() => null);
  if (!st || !st.isDirectory()) {
    const hint = seedKey ? `seed key: ${seedKey}` : "seed key: <missing>";
    throw new Error(`runInTemp: seed store path missing: ${seedPath}\n${hint}\nrerun v`);
  }
}

export function configuredSeedStore(): SeedStoreConfiguration {
  if (wantsFilteredRsync()) return { mode: "rsync", seedKey: "", seedPath: "" };
  const seedPath = String(process.env.VBR_TEST_SEED_STORE_PATH || "").trim();
  const seedKey = String(process.env.VBR_TEST_SEED_KEY || "").trim();
  if (!seedPath) {
    if (isVerifyMode()) {
      throw new Error("runInTemp: missing VBR_TEST_SEED_STORE_PATH; rerun v");
    }
    return { mode: "rsync", seedKey: "", seedPath: "" };
  }
  return { mode: "seed-store", seedKey, seedPath };
}

export async function preflightConfiguredSeedForTempRepo(): Promise<void> {
  const config = configuredSeedStore();
  if (config.mode === "seed-store") await requireSeedPath(config.seedPath, config.seedKey);
}
