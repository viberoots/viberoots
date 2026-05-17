#!/usr/bin/env zx-wrapper
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

export async function writeSprinkleRefConfig(config: unknown) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprinkleref-infisical-"));
  const file = path.join(dir, "config.json");
  await fs.writeFile(file, `${JSON.stringify({ version: 1, ...config }, null, 2)}\n`);
  return file;
}
