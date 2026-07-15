#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { getFlagStr } from "../lib/cli";
import { direnvStage0 } from "../lib/consumer-direnv";

async function main(): Promise<void> {
  const root = path.resolve(getFlagStr("workspace-root", process.cwd()));
  const file = path.join(root, ".viberoots/bootstrap/direnv-stage0.sh");
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.mkdir(path.dirname(file), { recursive: true });
  try {
    await fsp.writeFile(tmp, direnvStage0(), { mode: 0o644 });
    await fsp.rename(tmp, file);
  } finally {
    await fsp.rm(tmp, { force: true }).catch(() => {});
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
