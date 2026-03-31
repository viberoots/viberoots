import path from "node:path";
import * as fsp from "node:fs/promises";
import crypto from "node:crypto";

function sha256Hex(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

async function readTextSafe(p: string): Promise<string> {
  try {
    return await fsp.readFile(p, "utf8");
  } catch {
    return "";
  }
}

export async function unifiedPnpmStoreEpochDigest(repo: string): Promise<string> {
  const rels = [
    "build-tools/tools/nix/node-modules.hashes.json",
    "build-tools/tools/dev/require-unified-pnpm-store.ts",
    "build-tools/tools/dev/unified-pnpm-store-epoch.ts",
    "build-tools/tools/dev/update-pnpm-hash/prefetched-store.ts",
    "build-tools/tools/dev/update-pnpm-hash/lockfile.ts",
    "build-tools/tools/dev/update-pnpm-hash/lockfile-shared.ts",
    "build-tools/tools/dev/update-pnpm-hash/importer-lockfile.ts",
    "build-tools/tools/dev/update-pnpm-hash/exact-store.ts",
    "build-tools/tools/lib/pnpm-importer-lockfile.ts",
    "build-tools/tools/nix/node-modules/store.nix",
    "build-tools/tools/nix/node-modules/common.nix",
    "build-tools/tools/nix/flake/packages/node-mods.nix",
  ];
  const chunks: string[] = [];
  for (const rel of rels) {
    const abs = path.join(repo, rel);
    chunks.push(`@@ ${rel}\n${await readTextSafe(abs)}`);
  }
  return sha256Hex(chunks.join("\n"));
}
