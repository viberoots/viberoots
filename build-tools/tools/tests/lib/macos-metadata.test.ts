import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  MACOS_METADATA_NEVER_INDEX_FILE,
  markMacosMetadataNeverIndex,
  mkdirWithMacosMetadataExclusion,
} from "../../lib/macos-metadata";

test("macOS metadata helper marks generated roots on Darwin only", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "macos-metadata-"));
  try {
    const darwinDir = path.join(root, "darwin");
    await mkdirWithMacosMetadataExclusion(darwinDir, "darwin");
    const marker = await fsp.stat(path.join(darwinDir, MACOS_METADATA_NEVER_INDEX_FILE));
    assert.ok(marker.isFile());

    const linuxDir = path.join(root, "linux");
    await fsp.mkdir(linuxDir, { recursive: true });
    await markMacosMetadataNeverIndex(linuxDir, "linux");
    await assert.rejects(fsp.stat(path.join(linuxDir, MACOS_METADATA_NEVER_INDEX_FILE)));
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
