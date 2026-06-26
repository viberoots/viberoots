import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

export const MACOS_METADATA_NEVER_INDEX_FILE = ".metadata_never_index";

export async function markMacosMetadataNeverIndex(
  dir: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  if (platform !== "darwin") return;
  await fsp.mkdir(dir, { recursive: true }).catch(() => {});
  const marker = path.join(dir, MACOS_METADATA_NEVER_INDEX_FILE);
  let handle: fsp.FileHandle | undefined;
  try {
    handle = await fsp.open(marker, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return;
    return;
  } finally {
    await handle?.close().catch(() => {});
  }
}

export async function mkdirWithMacosMetadataExclusion(
  dir: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  await fsp.mkdir(dir, { recursive: true });
  await markMacosMetadataNeverIndex(dir, platform);
}

export async function mkdtempNoindex(
  prefix: string,
  opts: {
    baseName?: string;
    platform?: NodeJS.Platform;
    tmpBase?: string;
  } = {},
): Promise<string> {
  const platform = opts.platform ?? process.platform;
  const tmpBase = opts.tmpBase ?? process.env.TMPDIR ?? os.tmpdir();
  if (platform !== "darwin") {
    return await fsp.mkdtemp(path.join(tmpBase, prefix));
  }
  const baseName = opts.baseName ?? "viberoots-tmp";
  const base = path.join(tmpBase, `${baseName}.noindex`);
  await mkdirWithMacosMetadataExclusion(base, platform);
  const dir = await fsp.mkdtemp(path.join(base, prefix));
  await markMacosMetadataNeverIndex(dir, platform);
  return dir;
}

export async function emptyDirectoryPreservingMacosMetadataExclusion(
  dir: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  await markMacosMetadataNeverIndex(dir, platform);
  let entries: string[] = [];
  try {
    entries = await fsp.readdir(dir);
  } catch {
    return;
  }
  await Promise.all(
    entries
      .filter((entry) => entry !== MACOS_METADATA_NEVER_INDEX_FILE)
      .map((entry) => fsp.rm(path.join(dir, entry), { recursive: true, force: true })),
  );
}
