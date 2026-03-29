import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";

export type PnpmStoreVerifiedMarker = {
  importer: string;
  lockfile: string;
  lockHash: string;
  hashValue: string;
  builderFingerprint: string;
};

export function verifiedMarkerPath(repoRoot: string, importer: string): string {
  const key =
    importer === "." ? "root" : importer.replace(/[\\/]+/g, "-").replace(/[^A-Za-z0-9._-]/g, "-");
  return path.join(repoRoot, "buck-out", "tmp", `pnpm-store-verified.${key}.json`);
}

export async function sha256File(absPath: string): Promise<string> {
  try {
    const buf = await fsp.readFile(absPath);
    return crypto.createHash("sha256").update(buf).digest("hex");
  } catch {
    return "";
  }
}

export async function readVerifiedMarker(
  markerPath: string,
): Promise<PnpmStoreVerifiedMarker | null> {
  try {
    const raw = await fsp.readFile(markerPath, "utf8");
    const m = JSON.parse(raw) as Partial<PnpmStoreVerifiedMarker>;
    const importer = String(m.importer || "").trim();
    const lockfile = String(m.lockfile || "").trim();
    const lockHash = String(m.lockHash || "").trim();
    const hashValue = String(m.hashValue || "").trim();
    const builderFingerprint = String(m.builderFingerprint || "").trim();
    if (!importer || !lockfile || !lockHash || !hashValue || !builderFingerprint) return null;
    return { importer, lockfile, lockHash, hashValue, builderFingerprint };
  } catch {
    return null;
  }
}

export async function currentVerifiedMarkerFingerprint(repoRoot: string): Promise<string> {
  const files = [
    "build-tools/tools/dev/update-pnpm-hash.ts",
    "build-tools/tools/dev/update-pnpm-hash/lockfile.ts",
    "build-tools/tools/dev/update-pnpm-hash/nondefault.ts",
    "build-tools/tools/dev/update-pnpm-hash/nix.ts",
    "build-tools/tools/dev/update-pnpm-hash/prefetched-store.ts",
    "build-tools/tools/nix/node-modules/store.nix",
    "build-tools/tools/nix/node-modules/modules.nix",
    "build-tools/tools/lib/pnpm-importer-lockfile.ts",
    "build-tools/tools/lib/pnpm-state-paths.ts",
  ];
  const hash = crypto.createHash("sha256");
  hash.update(`platform=${process.platform}\n`);
  hash.update(`arch=${process.arch}\n`);
  for (const rel of files) {
    hash.update(`file=${rel}\n`);
    try {
      hash.update(await fsp.readFile(path.join(repoRoot, rel), "utf8"));
    } catch {
      hash.update("<missing>");
    }
    hash.update("\n");
  }
  return hash.digest("hex");
}

export async function writeVerifiedMarker(
  markerPath: string,
  marker: PnpmStoreVerifiedMarker,
): Promise<void> {
  await fsp.mkdir(path.dirname(markerPath), { recursive: true }).catch(() => {});
  await fsp.writeFile(markerPath, JSON.stringify(marker, null, 2) + "\n", "utf8");
}
