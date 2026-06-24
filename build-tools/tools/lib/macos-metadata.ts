import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";

export const MACOS_METADATA_NEVER_INDEX_FILE = ".metadata_never_index";

export async function markMacosMetadataNeverIndex(
  dir: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  if (platform !== "darwin") return;
  await fsp.mkdir(dir, { recursive: true }).catch(() => {});
  await fsp.writeFile(path.join(dir, MACOS_METADATA_NEVER_INDEX_FILE), "", "utf8").catch(() => {});
}

export async function mkdirWithMacosMetadataExclusion(
  dir: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  await fsp.mkdir(dir, { recursive: true });
  await markMacosMetadataNeverIndex(dir, platform);
}
