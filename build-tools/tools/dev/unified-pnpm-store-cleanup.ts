import * as fsp from "node:fs/promises";
import path from "node:path";

function pnpmStoreVersionNumber(name: string): number | null {
  const match = name.match(/^v(\d+)$/);
  if (!match) return null;
  const version = Number(match[1]);
  return Number.isSafeInteger(version) ? version : null;
}

export async function pruneStalePnpmStoreVersions(unifyStore: string): Promise<void> {
  let ents: Array<fsp.Dirent>;
  try {
    ents = await fsp.readdir(unifyStore, { withFileTypes: true });
  } catch {
    return;
  }
  const versions = ents
    .filter((ent) => ent.isDirectory())
    .flatMap((ent) => {
      const version = pnpmStoreVersionNumber(ent.name);
      return version === null ? [] : [{ name: ent.name, version }];
    });
  if (versions.length <= 1) return;
  const currentVersion = Math.max(...versions.map((entry) => entry.version));
  for (const entry of versions) {
    if (entry.version >= currentVersion) continue;
    await fsp.rm(path.join(unifyStore, entry.name), { recursive: true, force: true });
  }
}

function pnpmStoreEpochName(name: string): string | null {
  const match = name.match(/^store-([0-9a-f]{64})$/);
  return match ? match[1] : null;
}

export async function pruneStaleUnifiedPnpmStoreEpochs(opts: {
  stateDir: string;
  activeUnifyDir: string;
}): Promise<void> {
  const stateDir = path.resolve(opts.stateDir);
  const activeUnifyDir = path.resolve(opts.activeUnifyDir);
  if (path.dirname(activeUnifyDir) !== stateDir) return;
  const activeName = path.basename(activeUnifyDir);
  if (pnpmStoreEpochName(activeName) === null) return;

  let ents: Array<fsp.Dirent>;
  try {
    ents = await fsp.readdir(stateDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of ents) {
    if (!ent.isDirectory() || ent.name === activeName || pnpmStoreEpochName(ent.name) === null) {
      continue;
    }
    await fsp.rm(path.join(stateDir, ent.name), { recursive: true, force: true });
  }
}
