import path from "node:path";

import * as fsp from "node:fs/promises";

import { exists } from "../fs.ts";

export async function runPostSteps(dest: string) {
  const goMod = path.join(dest, "go.mod");
  if (await exists(goMod)) {
    try {
      await $`bash -c 'cd ${dest} && go fmt ./... || true && go mod tidy || true'`;
    } catch {}
  }
}
